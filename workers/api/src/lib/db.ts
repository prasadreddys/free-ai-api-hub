// FREE AI API HUB — D1 data-access layer.
// Every SQL statement the gateway runs lives here, parameterized, so the
// hot paths are reviewable in one place. Prompt/response content is never
// stored (store_prompts defaults to 0). Original code for this project.

import type { D1Database } from "@cloudflare/workers-types";

export interface ProviderKeyRow {
  id: string;
  provider: string;
  label: string | null;
  key_encrypted: string;
  key_iv: string;
  key_tag: string;
  key_version: number;
  key_masked: string;
  priority: number;
  enabled: number;
  status: string;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
  base_url: string | null;
  model_id: string | null;
}

export interface UnifiedKeyRow {
  id: string;
  name: string;
  key_hash: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  daily_limit: number | null;
  revoked_at: string | null;
}

export interface ModelRow {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  capabilities: string; // JSON array
  context_window: number | null;
  supports_streaming: number;
  supports_tools: number;
  supports_vision: number;
  free_tier: number;
  verified: number;
  last_verified_at: string | null;
  last_error: string | null;
  enabled: number;
}

export interface RoutingProfileRow {
  id: string;
  name: string;
  strategy: string;
  retry_limit: number;
  timeout_ms: number;
  cooldown_ms: number;
  is_default: number;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

// ---------------------------------------------------------------------------
// Unified keys
// ---------------------------------------------------------------------------

export async function getUnifiedKeyByHash(
  db: D1Database,
  keyHash: string,
): Promise<UnifiedKeyRow | null> {
  return db
    .prepare("SELECT * FROM unified_api_keys WHERE key_hash = ?")
    .bind(keyHash)
    .first<UnifiedKeyRow>();
}

export async function listUnifiedKeys(db: D1Database): Promise<UnifiedKeyRow[]> {
  const res = await db
    .prepare("SELECT * FROM unified_api_keys ORDER BY created_at DESC")
    .all<UnifiedKeyRow>();
  return res.results ?? [];
}

export async function insertUnifiedKey(
  db: D1Database,
  row: Pick<UnifiedKeyRow, "id" | "name" | "key_hash" | "prefix" | "daily_limit">,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO unified_api_keys (id, name, key_hash, prefix, daily_limit) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.name, row.key_hash, row.prefix, row.daily_limit)
    .run();
}

export async function touchUnifiedKey(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE unified_api_keys SET last_used_at = datetime('now'), request_count = request_count + 1 WHERE id = ?",
    )
    .bind(id)
    .run();
}

export async function revokeUnifiedKey(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE unified_api_keys SET revoked_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}

export async function countKeyRequestsToday(
  db: D1Database,
  keyId: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM usage_logs WHERE unified_key_id = ? AND created_at >= date('now')",
    )
    .bind(keyId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Provider keys
// ---------------------------------------------------------------------------

export async function listProviderKeys(
  db: D1Database,
  enabledOnly = false,
): Promise<ProviderKeyRow[]> {
  const res = await db
    .prepare(
      enabledOnly
        ? "SELECT * FROM provider_keys WHERE enabled = 1 ORDER BY priority ASC, created_at ASC"
        : "SELECT * FROM provider_keys ORDER BY priority ASC, created_at ASC",
    )
    .all<ProviderKeyRow>();
  return res.results ?? [];
}

export async function getProviderKey(
  db: D1Database,
  id: string,
): Promise<ProviderKeyRow | null> {
  return db.prepare("SELECT * FROM provider_keys WHERE id = ?").bind(id).first<ProviderKeyRow>();
}

export async function getHealthyProviderKeys(
  db: D1Database,
  provider: string,
): Promise<ProviderKeyRow[]> {
  const res = await db
    .prepare(
      "SELECT * FROM provider_keys WHERE provider = ? AND enabled = 1 AND status != 'auth_failed' ORDER BY priority ASC, created_at ASC",
    )
    .bind(provider)
    .all<ProviderKeyRow>();
  return res.results ?? [];
}

export async function insertProviderKey(
  db: D1Database,
  row: Omit<ProviderKeyRow, "created_at" | "last_tested_at" | "last_error"> & {
    last_tested_at?: string | null;
    last_error?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO provider_keys
       (id, provider, label, key_encrypted, key_iv, key_tag, key_version,
        key_masked, priority, enabled, status, last_tested_at, last_error,
        base_url, model_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id, row.provider, row.label, row.key_encrypted, row.key_iv, row.key_tag,
      row.key_version, row.key_masked, row.priority, row.enabled, row.status,
      row.last_tested_at ?? null, row.last_error ?? null, row.base_url ?? null,
      row.model_id ?? null,
    )
    .run();
}

export async function updateProviderKey(
  db: D1Database,
  id: string,
  patch: Partial<Pick<ProviderKeyRow, "label" | "priority" | "enabled" | "status" | "last_tested_at" | "last_error">>,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  await db
    .prepare(`UPDATE provider_keys SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals, id)
    .run();
}

export async function deleteProviderKey(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM provider_keys WHERE id = ?").bind(id).run();
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function listModels(db: D1Database): Promise<ModelRow[]> {
  const res = await db
    .prepare("SELECT * FROM models ORDER BY provider ASC, display_name ASC")
    .all<ModelRow>();
  return res.results ?? [];
}

export async function getModelById(db: D1Database, id: string): Promise<ModelRow | null> {
  return db.prepare("SELECT * FROM models WHERE id = ?").bind(id).first<ModelRow>();
}

export async function getModelByProviderAndId(
  db: D1Database,
  provider: string,
  modelId: string,
): Promise<ModelRow | null> {
  return db
    .prepare("SELECT * FROM models WHERE provider = ? AND model_id = ?")
    .bind(provider, modelId)
    .first<ModelRow>();
}

export async function findModelsByModelId(
  db: D1Database,
  modelId: string,
): Promise<ModelRow[]> {
  const res = await db
    .prepare("SELECT * FROM models WHERE model_id = ? AND enabled = 1")
    .bind(modelId)
    .all<ModelRow>();
  return res.results ?? [];
}

export async function setModelVerified(
  db: D1Database,
  id: string,
  verified: boolean,
  error: string | null = null,
): Promise<void> {
  await db
    .prepare(
      "UPDATE models SET verified = ?, last_verified_at = datetime('now'), last_error = ? WHERE id = ?",
    )
    .bind(verified ? 1 : 0, error, id)
    .run();
}

export async function setModelEnabled(db: D1Database, id: string, enabled: boolean): Promise<void> {
  await db.prepare("UPDATE models SET enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, id).run();
}

export async function upsertModel(db: D1Database, row: ModelRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO models
       (id, provider, model_id, display_name, capabilities, context_window,
        supports_streaming, supports_tools, supports_vision, free_tier,
        verified, last_verified_at, last_error, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, model_id) DO UPDATE SET
         display_name = excluded.display_name,
         capabilities = excluded.capabilities,
         context_window = excluded.context_window,
         supports_streaming = excluded.supports_streaming,
         supports_tools = excluded.supports_tools,
         supports_vision = excluded.supports_vision,
         free_tier = excluded.free_tier`,
    )
    .bind(
      row.id, row.provider, row.model_id, row.display_name, row.capabilities,
      row.context_window, row.supports_streaming, row.supports_tools,
      row.supports_vision, row.free_tier, row.verified, row.last_verified_at,
      row.last_error, row.enabled,
    )
    .run();
}

// ---------------------------------------------------------------------------
// Routing profiles
// ---------------------------------------------------------------------------

export async function listProfiles(db: D1Database): Promise<RoutingProfileRow[]> {
  const res = await db
    .prepare("SELECT * FROM routing_profiles ORDER BY is_default DESC, name ASC")
    .all<RoutingProfileRow>();
  return res.results ?? [];
}

export async function getProfile(db: D1Database, id: string): Promise<RoutingProfileRow | null> {
  return db.prepare("SELECT * FROM routing_profiles WHERE id = ?").bind(id).first<RoutingProfileRow>();
}

export async function getProfileByName(db: D1Database, name: string): Promise<RoutingProfileRow | null> {
  return db
    .prepare("SELECT * FROM routing_profiles WHERE name = ?")
    .bind(name)
    .first<RoutingProfileRow>();
}

export async function getDefaultProfile(db: D1Database): Promise<RoutingProfileRow | null> {
  return db
    .prepare("SELECT * FROM routing_profiles WHERE is_default = 1 LIMIT 1")
    .first<RoutingProfileRow>();
}

export async function getProfileModelIds(db: D1Database, profileId: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT model_id FROM profile_models WHERE profile_id = ? ORDER BY position ASC")
    .bind(profileId)
    .all<{ model_id: string }>();
  return (res.results ?? []).map((r) => r.model_id);
}

export async function upsertProfile(
  db: D1Database,
  profile: RoutingProfileRow,
  modelIds: string[],
): Promise<void> {
  // Only one profile may be the default: clear the flag everywhere else.
  if (profile.is_default === 1) {
    await db
      .prepare("UPDATE routing_profiles SET is_default = 0 WHERE id != ?")
      .bind(profile.id)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO routing_profiles (id, name, strategy, retry_limit, timeout_ms, cooldown_ms, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, strategy = excluded.strategy,
         retry_limit = excluded.retry_limit, timeout_ms = excluded.timeout_ms,
         cooldown_ms = excluded.cooldown_ms, is_default = excluded.is_default`,
    )
    .bind(
      profile.id, profile.name, profile.strategy, profile.retry_limit,
      profile.timeout_ms, profile.cooldown_ms, profile.is_default,
    )
    .run();
  await db.prepare("DELETE FROM profile_models WHERE profile_id = ?").bind(profile.id).run();
  for (let i = 0; i < modelIds.length; i++) {
    await db
      .prepare("INSERT INTO profile_models (profile_id, model_id, position) VALUES (?, ?, ?)")
      .bind(profile.id, modelIds[i], i + 1)
      .run();
  }
}

export async function deleteProfile(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM profile_models WHERE profile_id = ?").bind(id).run();
  await db.prepare("DELETE FROM routing_profiles WHERE id = ?").bind(id).run();
}

// ---------------------------------------------------------------------------
// Usage / request logs
// ---------------------------------------------------------------------------

export interface UsageLogInput {
  id: string;
  unified_key_id: string | null;
  provider: string;
  model_id: string;
  status: "success" | "error";
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  routed_via: string | null;
  fallback_count: number;
  error_type: string | null;
}

export async function insertUsageLog(db: D1Database, log: UsageLogInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage_logs
       (id, unified_key_id, provider, model_id, status, prompt_tokens,
        completion_tokens, latency_ms, routed_via, fallback_count, error_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      log.id, log.unified_key_id, log.provider, log.model_id, log.status,
      log.prompt_tokens, log.completion_tokens, log.latency_ms, log.routed_via,
      log.fallback_count, log.error_type,
    )
    .run();
}

export interface RequestLogInput {
  id: string;
  request_id: string;
  unified_key_id: string | null;
  provider: string;
  model_id: string;
  status: "success" | "error";
  latency_ms: number;
  error_type: string | null;
  error_message: string | null;
  /** Stored only when store_prompts=1 (migration 0004 columns). */
  prompt_text?: string | null;
  response_text?: string | null;
}

export async function insertRequestLog(db: D1Database, log: RequestLogInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO request_logs
       (id, request_id, unified_key_id, provider, model_id, status,
        latency_ms, error_type, error_message, prompt_text, response_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      log.id, log.request_id, log.unified_key_id, log.provider, log.model_id,
      log.status, log.latency_ms, log.error_type, log.error_message,
      log.prompt_text ?? null, log.response_text ?? null,
    )
    .run();
}

/** Count requests for a key in the last N seconds (rate limiting). */
export async function countKeyRequestsSince(
  db: D1Database,
  keyId: string,
  seconds: number,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM usage_logs WHERE unified_key_id = ? AND created_at >= datetime('now', ?)",
    )
    .bind(keyId, `-${seconds} seconds`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface UsageAggregate {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  avg_latency_ms: number;
  fallback_events: number;
}

export async function getUsageAggregate(
  db: D1Database,
  sinceSql: string,
  keyId?: string | null,
): Promise<UsageAggregate> {
  const keyFilter = keyId ? " AND unified_key_id = ?" : "";
  const binds: unknown[] = keyId ? [keyId] : [];
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total_requests,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful_requests,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed_requests,
              SUM(prompt_tokens + completion_tokens) AS total_tokens,
              SUM(prompt_tokens) AS prompt_tokens,
              SUM(completion_tokens) AS completion_tokens,
              AVG(latency_ms) AS avg_latency_ms,
              SUM(CASE WHEN fallback_count > 0 THEN 1 ELSE 0 END) AS fallback_events
       FROM usage_logs WHERE created_at >= ${sinceSql}${keyFilter}`,
    )
    .bind(...binds)
    .first<UsageAggregate>();
  return {
    total_requests: row?.total_requests ?? 0,
    successful_requests: row?.successful_requests ?? 0,
    failed_requests: row?.failed_requests ?? 0,
    total_tokens: row?.total_tokens ?? 0,
    prompt_tokens: row?.prompt_tokens ?? 0,
    completion_tokens: row?.completion_tokens ?? 0,
    avg_latency_ms: Math.round(row?.avg_latency_ms ?? 0),
    fallback_events: row?.fallback_events ?? 0,
  };
}

export async function getUsageByDimension(
  db: D1Database,
  sinceSql: string,
  dimension: "provider" | "model_id",
  keyId?: string | null,
): Promise<{ key: string; requests: number; tokens: number; errors: number }[]> {
  const keyFilter = keyId ? " AND unified_key_id = ?" : "";
  const binds: unknown[] = keyId ? [keyId] : [];
  const res = await db
    .prepare(
      `SELECT ${dimension} AS key, COUNT(*) AS requests,
              SUM(prompt_tokens + completion_tokens) AS tokens,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM usage_logs WHERE created_at >= ${sinceSql}${keyFilter}
       GROUP BY ${dimension} ORDER BY requests DESC`,
    )
    .bind(...binds)
    .all<{ key: string; requests: number; tokens: number; errors: number }>();
  return res.results ?? [];
}

export async function getHourlyTimeline(
  db: D1Database,
  sinceSql: string,
  keyId?: string | null,
): Promise<{ hour: string; requests: number; errors: number; tokens_in: number; tokens_out: number }[]> {
  const keyFilter = keyId ? " AND unified_key_id = ?" : "";
  const binds: unknown[] = keyId ? [keyId] : [];
  const res = await db
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour, COUNT(*) AS requests,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
              SUM(prompt_tokens) AS tokens_in, SUM(completion_tokens) AS tokens_out
       FROM usage_logs WHERE created_at >= ${sinceSql}${keyFilter}
       GROUP BY hour ORDER BY hour ASC`,
    )
    .bind(...binds)
    .all<{ hour: string; requests: number; errors: number; tokens_in: number; tokens_out: number }>();
  return res.results ?? [];
}

export async function getRecentUsage(
  db: D1Database,
  limit = 20,
): Promise<(UsageLogInput & { created_at: string })[]> {
  const res = await db
    .prepare("SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<UsageLogInput & { created_at: string }>();
  return res.results ?? [];
}

export interface RollupInput {
  hour: string;
  provider: string;
  model_id: string;
  requests: number;
  errors: number;
  tokens_in: number;
  tokens_out: number;
  latency_p50: number | null;
  latency_p95: number | null;
}

/** Insert or replace one hourly rollup row. */
export async function upsertRollup(db: D1Database, row: RollupInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO hourly_rollups
       (hour, provider, model_id, requests, errors, tokens_in, tokens_out, latency_p50, latency_p95)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hour, provider, model_id) DO UPDATE SET
         requests = excluded.requests, errors = excluded.errors,
         tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
         latency_p50 = excluded.latency_p50, latency_p95 = excluded.latency_p95`,
    )
    .bind(
      row.hour, row.provider, row.model_id, row.requests, row.errors,
      row.tokens_in, row.tokens_out, row.latency_p50, row.latency_p95,
    )
    .run();
}

/** Delete usage/request logs older than `days` (retention prune). */
export async function pruneLogs(db: D1Database, days: number): Promise<number> {
  const usage = await db
    .prepare("DELETE FROM usage_logs WHERE created_at < datetime('now', ?)")
    .bind(`-${days} days`)
    .run();
  await db
    .prepare("DELETE FROM request_logs WHERE created_at < datetime('now', ?)")
    .bind(`-${days} days`)
    .run();
  return usage.meta?.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Provider status / settings / users / audit
// ---------------------------------------------------------------------------

export async function getProviderStatus(
  db: D1Database,
): Promise<{ provider: string; status: string; last_check_at: string | null; last_error: string | null; quota_remaining: number | null; quota_reset_at: string | null }[]> {
  const res = await db.prepare("SELECT * FROM provider_status ORDER BY provider ASC").all<{
    provider: string; status: string; last_check_at: string | null; last_error: string | null;
    quota_remaining: number | null; quota_reset_at: string | null;
  }>();
  return res.results ?? [];
}

export async function setProviderStatus(
  db: D1Database,
  provider: string,
  status: string,
  error: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO provider_status (provider, status, last_check_at, last_error)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(provider) DO UPDATE SET
         status = excluded.status, last_check_at = excluded.last_check_at,
         last_error = excluded.last_error`,
    )
    .bind(provider, status, error)
    .run();
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM system_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, value)
    .run();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<UserRow>();
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createUser(db: D1Database, id: string, email: string, passwordHash: string): Promise<void> {
  await db
    .prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
    .bind(id, email.toLowerCase(), passwordHash)
    .run();
}

export async function insertAuditLog(
  db: D1Database,
  userId: string | null,
  action: string,
  detail: string | null,
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)")
    .bind(newId("audit"), userId, action, detail)
    .run();
}
