// FREE AI API HUB — POST /v1/test.
// Test a key/model without storing anything: runs a tiny probe completion
// and returns latency, the model served, and the upstream result.
// Tightly rate-limited (it spends provider quota): max 10 test calls per
// minute per unified key, on top of the normal rate limit.
// Original code for this project.

import type { Env } from "../env";
import { authenticateUnifiedKey, optionalAdmin } from "../auth";
import { decryptSecret } from "../lib/crypto";
import { ApiError, toErrorResponse } from "../lib/errors";
import {
  countKeyRequestsSince,
  getHealthyProviderKeys,
  insertRequestLog,
  insertUsageLog,
  listModels,
  newId,
} from "../lib/db";
import { getAdapter, getProviderDef } from "../adapters/registry";

const TEST_RPM = 10;

export async function handleTest(env: Env, request: Request): Promise<Response> {
  try {
    // Auth: unified key, or admin session.
    const adminId = await optionalAdmin(env, request);
    let unifiedKeyId: string | null = null;
    if (!adminId) {
      const key = await authenticateUnifiedKey(env, request);
      unifiedKeyId = key.id;
      // Tight per-minute cap for probe calls.
      const recent = await countKeyRequestsSince(env.DB, key.id, 60);
      if (recent >= TEST_RPM) {
        throw new ApiError(
          429,
          "rate_limit_error",
          `Test endpoint is limited to ${TEST_RPM} calls per minute (it spends provider quota)`,
        );
      }
    }

    const body = (await request.json().catch(() => null)) as {
      provider?: unknown;
      model?: unknown;
      key?: unknown;
    } | null;
    if (!body || typeof body.provider !== "string" || body.provider.trim() === "") {
      throw new ApiError(400, "invalid_request_error", "`provider` is required");
    }
    const provider = body.provider.trim().toLowerCase();
    const model = typeof body.model === "string" && body.model.trim() !== "" ? body.model.trim() : null;
    const def = getProviderDef(provider);
    if (!def && provider !== "custom") {
      throw new ApiError(400, "invalid_request_error", `Unknown provider: ${provider}`);
    }

    const started = Date.now();
    const requestId = newId("req");
    let apiKey: string;
    let baseUrl: string | null = null;
    if (typeof body.key === "string" && body.key.trim() !== "") {
      // Test a supplied key without storing it.
      apiKey = body.key.trim();
      if (provider === "custom") {
        throw new ApiError(
          400,
          "invalid_request_error",
          "Testing a custom provider needs a stored key (the base URL is required)",
        );
      }
    } else {
      // Test the stored key for this provider.
      const keys = await getHealthyProviderKeys(env.DB, provider);
      if (keys.length === 0) {
        throw new ApiError(
          400,
          "invalid_request_error",
          `No healthy key is configured for provider "${provider}"`,
        );
      }
      const row = keys[0];
      baseUrl = row.base_url;
      // Keyless providers (Workers AI binding) store no key to decrypt.
      apiKey = def?.keyless
        ? ""
        : await decryptSecret(
            { ciphertext: row.key_encrypted, iv: row.key_iv, tag: row.key_tag },
            env.ENCRYPTION_KEY,
          );
    }

    // Resolve the model to probe with: explicit model, else first catalog row.
    let modelId: string | null = model;
    if (!modelId) {
      const models = await listModels(env.DB);
      const first = models.find((m) => m.provider === provider && m.enabled === 1);
      modelId = first?.model_id ?? null;
    }
    if (!modelId) {
      throw new ApiError(400, "invalid_request_error", `No model is configured for provider "${provider}"`);
    }

    const adapter = getAdapter(provider, { baseUrlOverride: baseUrl, ai: env.AI });
    const result = await adapter.validateKey(apiKey, modelId);
    const latencyMs = Date.now() - started;
    await insertRequestLog(env.DB, {
      id: newId("att"),
      request_id: requestId,
      unified_key_id: unifiedKeyId,
      provider,
      model_id: modelId,
      status: result.valid ? "success" : "error",
      latency_ms: latencyMs,
      error_type: result.valid ? null : "invalid_request_error",
      error_message: result.valid ? null : (result.error ?? "validation failed"),
    });
    await insertUsageLog(env.DB, {
      id: requestId,
      unified_key_id: unifiedKeyId,
      provider,
      model_id: modelId,
      status: result.valid ? "success" : "error",
      prompt_tokens: 0,
      completion_tokens: 0,
      latency_ms: latencyMs,
      routed_via: `${provider}/${modelId}`,
      fallback_count: 0,
      error_type: result.valid ? null : "invalid_request_error",
    });
    return new Response(
      JSON.stringify({
        valid: result.valid,
        provider,
        model: modelId,
        latency_ms: latencyMs,
        error: result.error ?? null,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
