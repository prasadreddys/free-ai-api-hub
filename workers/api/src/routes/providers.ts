// FREE AI API HUB — GET /v1/providers (+ admin view).
// A provider is `operational` only when it has a healthy, verified key and
// a passing health check. Otherwise the status says so plainly.
// Original code for this project.

import type { Env } from "../env";
import { authenticateUnifiedKey, requireAdmin } from "../auth";
import { ApiError, toErrorResponse } from "../lib/errors";
import { getHealthyProviderKeys, getProviderStatus, listProviderKeys } from "../lib/db";
import { getProviderDef, HELD_PROVIDER_IDS, PROVIDERS } from "../adapters/registry";
import type { ProviderInfo } from "@free-ai-api-hub/shared";

async function buildProviderList(env: Env): Promise<ProviderInfo[]> {
  const statuses = await getProviderStatus(env.DB);
  const statusByProvider = new Map(statuses.map((s) => [s.provider, s]));
  const keys = await listProviderKeys(env.DB, false);
  const healthyByProvider = new Map<string, number>();
  for (const k of keys) {
    if (k.enabled === 1 && k.status !== "auth_failed") {
      healthyByProvider.set(k.provider, (healthyByProvider.get(k.provider) ?? 0) + 1);
    }
  }
  const infos: ProviderInfo[] = [];
  // Built-in providers (registry) + any custom provider with a key.
  const ids = new Set<string>([...Object.keys(PROVIDERS), ...keys.map((k) => k.provider)]);
  for (const id of [...ids].sort()) {
    if (HELD_PROVIDER_IDS.has(id)) continue;
    const def = getProviderDef(id);
    const status = statusByProvider.get(id);
    const healthy = healthyByProvider.get(id) ?? 0;
    let derived: ProviderInfo["status"];
    if (healthy === 0) {
      derived = keys.some((k) => k.provider === id) ? "not_verified" : "not_configured";
    } else if (status?.status === "operational") {
      derived = "operational";
    } else if (status?.status === "degraded") {
      derived = "degraded";
    } else {
      derived = "not_verified";
    }
    infos.push({
      id,
      name: def?.name ?? (id === "custom" ? "Custom (OpenAI-compatible)" : id),
      status: derived,
      last_check_at: status?.last_check_at ?? null,
      last_error: status?.last_error ?? null,
      quota_remaining: status?.quota_remaining ?? null,
      quota_reset_at: status?.quota_reset_at ?? null,
    });
  }
  return infos;
}

/** GET /v1/providers — provider status (unified-key auth). */
export async function handleListProviders(env: Env, request: Request): Promise<Response> {
  try {
    await authenticateUnifiedKey(env, request);
    const providers = await buildProviderList(env);
    return new Response(JSON.stringify({ providers }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/providers — admin provider list (same data, admin auth). */
export async function handleAdminListProviders(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const providers = await buildProviderList(env);
    return new Response(JSON.stringify({ providers }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
