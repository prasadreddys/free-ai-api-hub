// FREE AI API HUB — scheduled jobs (Cron Triggers).
// Hourly: roll usage_logs into hourly_rollups, re-check stale keys.
// Daily: prune logs older than the retention setting.
//
// Everything is bounded (max 3 key re-checks per run) because free-tier
// KV writes are capped at 1,000/day and D1 writes at 100,000/day.
// Original code for this project.

import type { Env } from "./env";
import { decryptSecret } from "./lib/crypto";
import {
  getSetting,
  listModels,
  listProviderKeys,
  pruneLogs,
  updateProviderKey,
  upsertRollup,
} from "./lib/db";
import { getAdapter, getProviderDef } from "./adapters/registry";

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function buildRollups(env: Env): Promise<void> {
  // Aggregate the previous full hour of usage_logs into hourly_rollups.
  const hourStart = new Date();
  hourStart.setUTCMinutes(0, 0, 0);
  hourStart.setUTCHours(hourStart.getUTCHours() - 1);
  const hour = hourStart.toISOString().slice(0, 13) + ":00:00";
  const nextHour = new Date(hourStart.getTime() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 13) + ":00:00";

  const agg = await env.DB.prepare(
    `SELECT provider, model_id,
            COUNT(*) AS requests,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
            COALESCE(SUM(prompt_tokens), 0) AS tokens_in,
            COALESCE(SUM(completion_tokens), 0) AS tokens_out
     FROM usage_logs
     WHERE created_at >= ? AND created_at < ?
     GROUP BY provider, model_id`,
  )
    .bind(hour, nextHour)
    .all<{
      provider: string;
      model_id: string;
      requests: number;
      errors: number;
      tokens_in: number;
      tokens_out: number;
    }>();
  for (const row of agg.results ?? []) {
    // Latency percentiles for this (hour, provider, model) bucket.
    const latencies = await env.DB.prepare(
      `SELECT latency_ms FROM usage_logs
       WHERE provider = ? AND model_id = ? AND created_at >= ? AND created_at < ?
       ORDER BY latency_ms ASC`,
    )
      .bind(row.provider, row.model_id, hour, nextHour)
      .all<{ latency_ms: number }>();
    const sorted = (latencies.results ?? []).map((r) => r.latency_ms);
    await upsertRollup(env.DB, {
      hour,
      provider: row.provider,
      model_id: row.model_id,
      requests: row.requests,
      errors: row.errors,
      tokens_in: row.tokens_in,
      tokens_out: row.tokens_out,
      latency_p50: percentile(sorted, 50),
      latency_p95: percentile(sorted, 95),
    });
  }
}

async function recheckStaleKeys(env: Env): Promise<void> {
  // Only re-check keys that are unhealthy or not tested in >24h, max 3.
  // Healthy keys are probed only on demand (stale-only probing), because
  // every probe spends provider quota. Keyless providers need no probe.
  const keys = await listProviderKeys(env.DB, true);
  const stale = keys
    .filter((k) => {
      if (getProviderDef(k.provider)?.keyless) return false;
      if (k.status !== "healthy") return true;
      if (!k.last_tested_at) return true;
      const age = Date.now() - new Date(k.last_tested_at).getTime();
      return age > 24 * 60 * 60 * 1000;
    })
    .slice(0, 3);
  for (const row of stale) {
    try {
      const models = await listModels(env.DB);
      const first = models.find((m) => m.provider === row.provider && m.enabled === 1);
      const decrypted = await decryptSecret(
        { ciphertext: row.key_encrypted, iv: row.key_iv, tag: row.key_tag },
        env.ENCRYPTION_KEY,
      );
      const adapter = getAdapter(row.provider, { baseUrlOverride: row.base_url, ai: env.AI });
      const result = await adapter.validateKey(decrypted, first?.model_id);
      await updateProviderKey(env.DB, row.id, {
        status: result.valid ? "healthy" : "error",
        last_tested_at: new Date().toISOString(),
        last_error: result.valid ? null : (result.error ?? "validation failed"),
      });
    } catch {
      // A failed re-check must not kill the whole cron run.
      await updateProviderKey(env.DB, row.id, {
        status: "error",
        last_tested_at: new Date().toISOString(),
        last_error: "Re-check failed",
      }).catch(() => undefined);
    }
  }
}

async function pruneAll(env: Env): Promise<void> {
  const retentionRaw = await getSetting(env.DB, "log_retention_days");
  const retention = retentionRaw ? Number.parseInt(retentionRaw, 10) || 30 : 30;
  await pruneLogs(env.DB, retention);
  await env.DB.prepare(
    `DELETE FROM audit_log WHERE created_at < datetime('now', ? || ' days')`,
  )
    .bind(`-${retention}`)
    .run();
}

/** Entry point for Cloudflare Cron Triggers. `cron` is the schedule string. */
export async function handleScheduled(env: Env, cron: string): Promise<void> {
  if (cron === "30 2 * * *") {
    await pruneAll(env);
    return;
  }
  // Hourly run (15 * * * *).
  await buildRollups(env);
  await recheckStaleKeys(env);
}
