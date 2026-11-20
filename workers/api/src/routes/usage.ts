// FREE AI API HUB — GET /v1/usage (+ admin analytics).
// Usage comes only from real D1 rows. Empty accounts return honest zeros.
// Original code for this project.

import type { Env } from "../env";
import { authenticateUnifiedKey, requireAdmin } from "../auth";
import { ApiError, toErrorResponse } from "../lib/errors";
import {
  getHourlyTimeline,
  getRecentUsage,
  getUsageAggregate,
  getUsageByDimension,
} from "../lib/db";
import type { UsageSummary } from "@free-ai-api-hub/shared";

export function windowToSince(window: string): { sinceSql: string; label: "24h" | "7d" | "30d" } {
  switch (window) {
    case "7d":
      return { sinceSql: "datetime('now', '-7 days')", label: "7d" };
    case "30d":
      return { sinceSql: "datetime('now', '-30 days')", label: "30d" };
    case "24h":
    default:
      return { sinceSql: "datetime('now', '-1 day')", label: "24h" };
  }
}

async function buildUsageSummary(
  env: Env,
  window: string,
  keyId: string | null,
): Promise<UsageSummary> {
  const { sinceSql, label } = windowToSince(window);
  const agg = await getUsageAggregate(env.DB, sinceSql, keyId);
  const byProviderRows = await getUsageByDimension(env.DB, sinceSql, "provider", keyId);
  const byModelRows = await getUsageByDimension(env.DB, sinceSql, "model_id", keyId);
  const by_provider: UsageSummary["by_provider"] = {};
  for (const r of byProviderRows) {
    by_provider[r.key] = { requests: r.requests, tokens: r.tokens, errors: r.errors };
  }
  const by_model: UsageSummary["by_model"] = {};
  for (const r of byModelRows) {
    by_model[r.key] = { requests: r.requests, tokens: r.tokens, errors: r.errors };
  }
  return {
    window: label,
    total_requests: agg.total_requests,
    successful_requests: agg.successful_requests,
    failed_requests: agg.failed_requests,
    total_tokens: agg.total_tokens,
    prompt_tokens: agg.prompt_tokens,
    completion_tokens: agg.completion_tokens,
    avg_latency_ms: agg.avg_latency_ms,
    fallback_events: agg.fallback_events,
    by_provider,
    by_model,
  };
}

/** GET /v1/usage?window=24h|7d|30d — usage for the calling unified key. */
export async function handleUsage(env: Env, request: Request): Promise<Response> {
  try {
    const key = await authenticateUnifiedKey(env, request);
    const url = new URL(request.url);
    const summary = await buildUsageSummary(env, url.searchParams.get("window") ?? "24h", key.id);
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/analytics/summary?window=… — admin usage across all keys. */
export async function handleAdminAnalyticsSummary(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const url = new URL(request.url);
    const summary = await buildUsageSummary(env, url.searchParams.get("window") ?? "24h", null);
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/analytics/timeline?window=… — hourly buckets (admin). */
export async function handleAdminAnalyticsTimeline(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const url = new URL(request.url);
    const { sinceSql } = windowToSince(url.searchParams.get("window") ?? "24h");
    const timeline = await getHourlyTimeline(env.DB, sinceSql, null);
    return new Response(JSON.stringify({ timeline }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/analytics/recent — recent requests (admin). */
export async function handleAdminRecent(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
    const recent = await getRecentUsage(env.DB, limit);
    return new Response(JSON.stringify({ recent }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
