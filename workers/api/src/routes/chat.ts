// FREE AI API HUB — POST /v1/chat/completions + POST /api/playground/chat.
// Unified-key auth, rate limiting, validation, router execution, and the
// X-Routed-Via header naming the provider/model that actually served it.
// Original code for this project.

import type { Env } from "../env";
import { authenticateUnifiedKey, requireAdmin } from "../auth";
import { envInt } from "../env";
import { ApiError, invalidRequest, toErrorResponse } from "../lib/errors";
import { checkRateLimit } from "../lib/rate-limit";
import { sseResponse } from "../lib/sse";
import { validateChatRequest } from "../lib/validate";
import { touchUnifiedKey, getSetting } from "../lib/db";
import { executeChat, executeChatStream } from "../router";

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new ApiError(413, "invalid_request_error", `Request body exceeds ${maxBytes} bytes`);
  }
  if (!text.trim()) throw invalidRequest("Request body must be a JSON object");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidRequest("Request body is not valid JSON");
  }
}

/** POST /v1/chat/completions — the core inference endpoint. */
export async function handleChatCompletion(
  env: Env,
  request: Request,
  ctx?: ExecutionContext,
): Promise<Response> {
  try {
    const key = await authenticateUnifiedKey(env, request);
    const rpmRaw = await getSetting(env.DB, "rate_limit_rpm");
    const rpm = rpmRaw ? Number.parseInt(rpmRaw, 10) || 120 : 120;
    await checkRateLimit(env.DB, key.id, { rpm, dailyLimit: key.daily_limit });
    const body = await readJsonBody(request, envInt(env, "MAX_BODY_BYTES", 1_048_576));
    const chatReq = validateChatRequest(body);

    if (chatReq.stream) {
      const outcome = await executeChatStream(env, chatReq, { unifiedKeyId: key.id });
      const res = sseResponse(outcome.chunks);
      res.headers.set("x-routed-via", outcome.routedVia);
      if (outcome.fallbackCount > 0) {
        res.headers.set("x-fallback-count", String(outcome.fallbackCount));
      }
      // Keep the isolate alive until the stream is fully consumed + logged.
      if (ctx) ctx.waitUntil(outcome.done.catch(() => undefined));
      else void outcome.done.catch(() => undefined);
      void touchUnifiedKey(env.DB, key.id);
      return res;
    }

    const outcome = await executeChat(env, chatReq, { unifiedKeyId: key.id });
    void touchUnifiedKey(env.DB, key.id);
    return new Response(JSON.stringify(outcome.response), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-routed-via": outcome.routedVia,
        ...(outcome.fallbackCount > 0
          ? { "x-fallback-count": String(outcome.fallbackCount) }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/**
 * POST /api/playground/chat — admin-only chat for the dashboard playground.
 * Runs the same router/adapters as /v1 (the real gateway), but authenticates
 * with the admin session so the unified key never enters the browser.
 * Usage is logged with unified_key_id NULL (playground traffic).
 */
export async function handlePlaygroundChat(
  env: Env,
  request: Request,
  ctx?: ExecutionContext,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const body = await readJsonBody(request, envInt(env, "MAX_BODY_BYTES", 1_048_576));
    const chatReq = validateChatRequest(body);
    if (chatReq.stream) {
      const outcome = await executeChatStream(env, chatReq, { unifiedKeyId: null });
      const res = sseResponse(outcome.chunks);
      res.headers.set("x-routed-via", outcome.routedVia);
      if (outcome.fallbackCount > 0) {
        res.headers.set("x-fallback-count", String(outcome.fallbackCount));
      }
      if (ctx) ctx.waitUntil(outcome.done.catch(() => undefined));
      else void outcome.done.catch(() => undefined);
      return res;
    }
    const outcome = await executeChat(env, chatReq, { unifiedKeyId: null });
    return new Response(JSON.stringify(outcome.response), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-routed-via": outcome.routedVia,
        ...(outcome.fallbackCount > 0
          ? { "x-fallback-count": String(outcome.fallbackCount) }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
