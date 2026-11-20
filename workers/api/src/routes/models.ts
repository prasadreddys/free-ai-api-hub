// FREE AI API HUB — GET /v1/models (+ admin model management).
// A model is listed as `available` only when it is enabled, live-verified,
// and a healthy key exists for its provider. Everything else is honest
// about being unverified. Original code for this project.

import type { Env } from "../env";
import { authenticateUnifiedKey, requireAdmin } from "../auth";
import { ApiError, toErrorResponse } from "../lib/errors";
import {
  getHealthyProviderKeys,
  listModels,
  setModelEnabled,
  type ModelRow,
} from "../lib/db";
import type { ModelCapability, ModelInfo } from "@free-ai-api-hub/shared";

function parseCapabilities(raw: string): ModelCapability[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((c): c is ModelCapability => typeof c === "string") as ModelCapability[];
    }
  } catch {
    // fall through
  }
  return ["chat"];
}

export async function modelRowToInfo(
  env: Env,
  row: ModelRow,
  healthyProviders: Set<string>,
): Promise<ModelInfo> {
  return {
    id: row.id,
    provider: row.provider,
    model_id: row.model_id,
    display_name: row.display_name,
    capabilities: parseCapabilities(row.capabilities),
    context_window: row.context_window,
    supports_streaming: row.supports_streaming === 1,
    supports_tools: row.supports_tools === 1,
    supports_vision: row.supports_vision === 1,
    free_tier: row.free_tier === 1,
    verified: row.verified === 1,
    last_verified_at: row.last_verified_at,
    available:
      row.enabled === 1 && row.verified === 1 && healthyProviders.has(row.provider),
    last_error: row.last_error,
    enabled: row.enabled === 1,
  };
}

/** GET /v1/models — OpenAI `list` shape, with availability extensions. */
export async function handleListModels(env: Env, request: Request): Promise<Response> {
  try {
    await authenticateUnifiedKey(env, request);
    const url = new URL(request.url);
    const onlyAvailable = url.searchParams.get("available") === "true";
    const rows = await listModels(env.DB);
    // Which providers have at least one healthy key right now.
    const healthyProviders = new Set<string>();
    for (const row of rows) {
      if (healthyProviders.has(row.provider)) continue;
      const keys = await getHealthyProviderKeys(env.DB, row.provider);
      if (keys.length > 0) healthyProviders.add(row.provider);
    }
    const infos: ModelInfo[] = [];
    for (const row of rows) {
      const info = await modelRowToInfo(env, row, healthyProviders);
      if (onlyAvailable && !info.available) continue;
      infos.push(info);
    }
    const data = infos.map((m) => ({
      id: m.model_id,
      object: "model",
      created: 0,
      owned_by: m.provider,
      provider: m.provider,
      display_name: m.display_name,
      capabilities: m.capabilities,
      context_window: m.context_window,
      supports_streaming: m.supports_streaming,
      supports_tools: m.supports_tools,
      supports_vision: m.supports_vision,
      free_tier: m.free_tier,
      verified: m.verified,
      last_verified_at: m.last_verified_at,
      available: m.available,
      enabled: m.enabled,
    }));
    return new Response(JSON.stringify({ object: "list", data }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/models — admin model list (same data, admin auth). */
export async function handleAdminListModels(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const rows = await listModels(env.DB);
    const healthyProviders = new Set<string>();
    for (const row of rows) {
      if (healthyProviders.has(row.provider)) continue;
      const keys = await getHealthyProviderKeys(env.DB, row.provider);
      if (keys.length > 0) healthyProviders.add(row.provider);
    }
    const infos: ModelInfo[] = [];
    for (const row of rows) infos.push(await modelRowToInfo(env, row, healthyProviders));
    return new Response(JSON.stringify({ models: infos }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** PATCH /api/models/:id — admin enable/disable a model. */
export async function handleAdminUpdateModel(
  env: Env,
  request: Request,
  modelId: string,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== "boolean") {
      throw new ApiError(400, "invalid_request_error", "`enabled` (boolean) is required");
    }
    await setModelEnabled(env.DB, modelId, body.enabled);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
