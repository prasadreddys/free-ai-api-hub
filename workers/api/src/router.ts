// FREE AI API HUB — smart router.
// Resolves a model request to an ordered candidate list, runs the fallback
// loop (max 5 attempts), parses cooldowns, and never routes to a known-failed
// key or exhausted quota. Original code for this project.

import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "@free-ai-api-hub/shared";
import type { Env } from "./env";
import { ApiError, exhausted, normalizeError, upstreamError } from "./lib/errors";
import { decryptSecret } from "./lib/crypto";
import {
  getDefaultProfile,
  getHealthyProviderKeys,
  getModelById,
  getModelByProviderAndId,
  getProfileByName,
  getProfileModelIds,
  getSetting,
  findModelsByModelId,
  insertRequestLog,
  insertUsageLog,
  newId,
  setProviderStatus,
  updateProviderKey,
  type ModelRow,
  type ProviderKeyRow,
  type RoutingProfileRow,
} from "./lib/db";
import { getAdapter, getProviderDef } from "./adapters/registry";
import type { AdapterRequest } from "./adapters/base";

export interface Candidate {
  provider: string;
  model: ModelRow;
  key: ProviderKeyRow;
  decryptedKey: string;
  baseUrl: string | null;
}

export interface AttemptRecord {
  provider: string;
  model: string;
  error: string;
}

export interface ChatOutcome {
  response: ChatCompletionResponse;
  provider: string;
  modelId: string;
  routedVia: string;
  attempts: AttemptRecord[];
  fallbackCount: number;
  latencyMs: number;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Cooldowns (KV, written only on failure — never per request)
// ---------------------------------------------------------------------------

export function cooldownKvKey(provider: string, keyId: string): string {
  return `cooldown:${provider}:${keyId}`;
}

export async function isOnCooldown(
  kv: KVNamespace,
  provider: string,
  keyId: string,
): Promise<boolean> {
  const v = await kv.get(cooldownKvKey(provider, keyId));
  return v !== null;
}

export async function setCooldown(
  kv: KVNamespace,
  provider: string,
  keyId: string,
  seconds: number,
): Promise<void> {
  const ttl = Math.max(1, Math.min(86_400, Math.floor(seconds)));
  await kv.put(cooldownKvKey(provider, keyId), String(Date.now()), { expirationTtl: ttl });
}

/** Parse a back-off from a Retry-After header, a retryDelay field, or prose. */
export function parseBackoffSeconds(input: {
  retryAfterHeader?: string | null;
  bodyText?: string;
}): number | null {
  const header = input.retryAfterHeader;
  if (header) {
    const asInt = Number.parseInt(header, 10);
    if (Number.isFinite(asInt) && asInt > 0) return Math.min(asInt, 86_400);
    const asDate = Date.parse(header);
    if (Number.isFinite(asDate)) {
      const secs = Math.floor((asDate - Date.now()) / 1000);
      if (secs > 0) return Math.min(secs, 86_400);
    }
  }
  const text = input.bodyText ?? "";
  // google.rpc.RetryInfo.retryDelay: "17s"
  const delayMatch = text.match(/retryDelay["']?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i);
  if (delayMatch) return Math.min(Math.ceil(Number.parseFloat(delayMatch[1])), 86_400);
  // prose: "try again in 1m26s" / "in 90 seconds" / "after 2 minutes"
  const prose = text.match(/try again in\s+(?:(\d+)\s*m(?:in(?:ute)?s?)?\s*)?(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?/i);
  if (prose && (prose[1] || prose[2])) {
    const secs = (Number.parseInt(prose[1] ?? "0", 10) || 0) * 60 + (Number.parseInt(prose[2] ?? "0", 10) || 0);
    if (secs > 0) return Math.min(secs, 86_400);
  }
  const seconds = text.match(/(\d+)\s*seconds?/i);
  if (seconds) return Math.min(Number.parseInt(seconds[1], 10), 86_400);
  return null;
}

// ---------------------------------------------------------------------------
// Candidate resolution
// ---------------------------------------------------------------------------

interface ModelStats {
  total: number;
  ok: number;
  avgLatency: number | null;
}

async function getModelStats(env: Env, provider: string, modelId: string): Promise<ModelStats> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS ok,
            AVG(latency_ms) AS avgLatency
     FROM usage_logs
     WHERE provider = ? AND model_id = ? AND created_at >= datetime('now', '-1 day')`,
  )
    .bind(provider, modelId)
    .first<{ total: number; ok: number; avgLatency: number | null }>();
  return {
    total: row?.total ?? 0,
    ok: row?.ok ?? 0,
    avgLatency: row?.avgLatency ?? null,
  };
}

async function buildCandidates(
  env: Env,
  modelRows: ModelRow[],
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const model of modelRows) {
    if (!model.enabled) continue;
    const keys = await getHealthyProviderKeys(env.DB, model.provider);
    // Keyless providers (Workers AI binding) store no key to decrypt.
    const keyless = getProviderDef(model.provider)?.keyless === true;
    for (const key of keys) {
      if (await isOnCooldown(env.KV, model.provider, key.id)) continue;
      let decrypted = "";
      if (!keyless) {
        try {
          decrypted = await decryptSecret(
            { ciphertext: key.key_encrypted, iv: key.key_iv, tag: key.key_tag },
            env.ENCRYPTION_KEY,
          );
        } catch {
          // A key that cannot be decrypted is treated as failed, not fatal.
          continue;
        }
      }
      out.push({
        provider: model.provider,
        model,
        key,
        decryptedKey: decrypted,
        baseUrl: key.base_url,
      });
    }
  }
  return out;
}

function scoreCandidates(
  candidates: Candidate[],
  stats: Map<string, ModelStats>,
  strategy: string,
  rotationOffset: number,
): Candidate[] {
  const key = (c: Candidate) => `${c.provider}:${c.model.model_id}`;
  const withScore = candidates.map((c, i) => {
    const s = stats.get(key(c)) ?? { total: 0, ok: 0, avgLatency: null };
    const successRate = s.total > 0 ? s.ok / s.total : 0.5; // unknown = neutral
    const latency = s.avgLatency ?? Number.POSITIVE_INFINITY;
    return { c, i, successRate, latency, verified: c.model.verified === 1 };
  });
  if (strategy === "fastest") {
    withScore.sort((a, b) => a.latency - b.latency || b.successRate - a.successRate);
  } else if (strategy === "round_robin") {
    // Stateless rotation: start at an offset derived from today's volume.
    const rotated = [...withScore];
    const off = withScore.length > 0 ? rotationOffset % withScore.length : 0;
    return [...rotated.slice(off), ...rotated.slice(0, off)].map((x) => x.c);
  } else if (strategy === "manual_priority") {
    // Keep chain order (already in profile order, then key priority).
    return candidates;
  } else {
    // best_available (default): verified first, then success rate, then latency.
    withScore.sort(
      (a, b) =>
        Number(b.verified) - Number(a.verified) ||
        b.successRate - a.successRate ||
        a.latency - b.latency,
    );
  }
  return withScore.map((x) => x.c);
}

export interface ResolveResult {
  candidates: Candidate[];
  profile: RoutingProfileRow;
}

/** Resolve a model request string to an ordered candidate list. */
export async function resolveCandidates(env: Env, model: string): Promise<ResolveResult> {
  const trimmed = model.trim();
  let profile: RoutingProfileRow | null = null;
  let modelRows: ModelRow[] = [];

  if (trimmed === "auto" || trimmed.startsWith("auto:")) {
    const profileName = trimmed === "auto" ? null : trimmed.slice("auto:".length);
    if (profileName === "fast" || profileName === "smart") {
      profile = (await getProfileByName(env.DB, profileName)) ?? (await getDefaultProfile(env.DB));
    } else if (profileName) {
      profile = await getProfileByName(env.DB, profileName);
      if (!profile) {
        throw new ApiError(400, "invalid_request_error", `Unknown routing profile: ${profileName}`);
      }
    } else {
      profile = await getDefaultProfile(env.DB);
    }
    if (!profile) throw new ApiError(500, "server_error", "No default routing profile configured");
    const modelIds = await getProfileModelIds(env.DB, profile.id);
    for (const id of modelIds) {
      const row = await getModelById(env.DB, id);
      if (row) modelRows.push(row);
    }
    if (modelRows.length === 0) {
      throw new ApiError(400, "invalid_request_error", `Routing profile "${profile.name}" has no models`);
    }
  } else if (trimmed.includes("/")) {
    // "provider/model-id"
    const [provider, ...rest] = trimmed.split("/");
    const modelId = rest.join("/");
    const row = await getModelByProviderAndId(env.DB, provider, modelId);
    if (!row) {
      throw new ApiError(400, "invalid_request_error", `Unknown model: ${trimmed}`);
    }
    modelRows = [row];
    profile = (await getDefaultProfile(env.DB)) ?? {
      id: "profile-auto",
      name: "auto",
      strategy: "best_available",
      retry_limit: 5,
      timeout_ms: 30000,
      cooldown_ms: 60000,
      is_default: 1,
    };
  } else {
    const rows = await findModelsByModelId(env.DB, trimmed);
    if (rows.length === 0) {
      throw new ApiError(400, "invalid_request_error", `Unknown model: ${trimmed}`);
    }
    modelRows = rows;
    profile = (await getDefaultProfile(env.DB)) ?? {
      id: "profile-auto",
      name: "auto",
      strategy: "best_available",
      retry_limit: 5,
      timeout_ms: 30000,
      cooldown_ms: 60000,
      is_default: 1,
    };
  }

  const raw = await buildCandidates(env, modelRows);
  if (raw.length === 0) {
    // A configuration problem on the gateway side, not a bad client request.
    throw new ApiError(
      503,
      "server_error",
      `No healthy key can serve model "${trimmed}" (no key configured, all keys failed auth, or all are on cooldown)`,
    );
  }
  const stats = new Map<string, ModelStats>();
  for (const c of raw) {
    const k = `${c.provider}:${c.model.model_id}`;
    if (!stats.has(k)) stats.set(k, await getModelStats(env, c.provider, c.model.model_id));
  }
  // Rotation offset from today's volume (stateless round-robin).
  const todayRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM usage_logs WHERE created_at >= date('now')",
  ).first<{ n: number }>();
  const rotationOffset = todayRow?.n ?? 0;
  const candidates = scoreCandidates(raw, stats, profile.strategy, rotationOffset);
  return { candidates, profile };
}

// ---------------------------------------------------------------------------
// Fallback execution (non-streaming)
// ---------------------------------------------------------------------------

export async function executeChat(
  env: Env,
  req: AdapterRequest,
  auth: { unifiedKeyId: string | null },
): Promise<ChatOutcome> {
  const started = Date.now();
  const requestId = newId("req");
  const { candidates, profile } = await resolveCandidates(env, req.model);
  const maxAttempts = Math.max(1, Math.min(profile.retry_limit, 5));
  const attempts: AttemptRecord[] = [];
  // Prompt content is stored only when the admin explicitly enables it.
  const storePrompts = (await getSetting(env.DB, "store_prompts")) === "1";
  const promptText = storePrompts ? JSON.stringify(req.messages) : null;

  for (let i = 0; i < Math.min(candidates.length, maxAttempts); i++) {
    const candidate = candidates[i];
    const attemptStarted = Date.now();
    try {
      const adapter = getAdapter(candidate.provider, {
        baseUrlOverride: candidate.baseUrl,
        ai: env.AI,
      });
      const signal = AbortSignal.timeout(profile.timeout_ms);
      const response = await adapter.chat(candidate.decryptedKey, req, signal);
      const latencyMs = Date.now() - attemptStarted;
      await insertRequestLog(env.DB, {
        id: newId("att"),
        request_id: requestId,
        unified_key_id: auth.unifiedKeyId,
        provider: candidate.provider,
        model_id: candidate.model.model_id,
        status: "success",
        latency_ms: latencyMs,
        error_type: null,
        error_message: null,
        prompt_text: promptText,
        response_text: storePrompts ? (response.choices[0]?.message.content ?? "") : null,
      });
      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      await insertUsageLog(env.DB, {
        id: requestId,
        unified_key_id: auth.unifiedKeyId,
        provider: candidate.provider,
        model_id: candidate.model.model_id,
        status: "success",
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        latency_ms: Date.now() - started,
        routed_via: `${candidate.provider}/${candidate.model.model_id}`,
        fallback_count: attempts.length,
        error_type: null,
      });
      return {
        response,
        provider: candidate.provider,
        modelId: candidate.model.model_id,
        routedVia: `${candidate.provider}/${candidate.model.model_id}`,
        attempts,
        fallbackCount: attempts.length,
        latencyMs: Date.now() - started,
        usage,
      };
    } catch (err) {
      const apiErr = normalizeError(err);
      const latencyMs = Date.now() - attemptStarted;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model.model_id,
        error: apiErr.message,
      });
      await insertRequestLog(env.DB, {
        id: newId("att"),
        request_id: requestId,
        unified_key_id: auth.unifiedKeyId,
        provider: candidate.provider,
        model_id: candidate.model.model_id,
        status: "error",
        latency_ms: latencyMs,
        error_type: apiErr.type,
        error_message: apiErr.message,
        prompt_text: promptText,
      });
      // Auth failures bench the key permanently (until re-tested).
      if (apiErr.status === 401 || apiErr.status === 403) {
        await updateProviderKey(env.DB, candidate.key.id, {
          status: "auth_failed",
          last_error: apiErr.message,
        });
        await setProviderStatus(env.DB, candidate.provider, "degraded", apiErr.message);
        // Do not retry other keys for an auth failure of the *model*?
        // Auth failure is per-key; another key for the same provider may
        // work, so continue to the next candidate.
      } else if (apiErr.retryable) {
        const backoff = parseBackoffSeconds({ bodyText: apiErr.message }) ?? 60;
        await setCooldown(env.KV, candidate.provider, candidate.key.id, backoff);
      } else {
        // Non-retryable (400/404/etc.): stop the chain.
        await insertUsageLog(env.DB, {
          id: requestId,
          unified_key_id: auth.unifiedKeyId,
          provider: candidate.provider,
          model_id: candidate.model.model_id,
          status: "error",
          prompt_tokens: 0,
          completion_tokens: 0,
          latency_ms: Date.now() - started,
          routed_via: `${candidate.provider}/${candidate.model.model_id}`,
          fallback_count: attempts.length - 1,
          error_type: apiErr.type,
        });
        throw apiErr;
      }
      // If this was the last allowed attempt, stop.
      if (i >= Math.min(candidates.length, maxAttempts) - 1) break;
    }
  }

  // Exhausted: every candidate failed with a retryable error.
  const last = attempts[attempts.length - 1];
  const first = candidates[0];
  await insertUsageLog(env.DB, {
    id: requestId,
    unified_key_id: auth.unifiedKeyId,
    provider: first?.provider ?? "unknown",
    model_id: first?.model.model_id ?? req.model,
    status: "error",
    prompt_tokens: 0,
    completion_tokens: 0,
    latency_ms: Date.now() - started,
    routed_via: null,
    fallback_count: attempts.length,
    error_type: "exhausted_error",
  });
  void last;
  throw exhausted(attempts);
}

// ---------------------------------------------------------------------------
// Fallback execution (streaming)
// ---------------------------------------------------------------------------

export interface StreamOutcome {
  /** The first candidate that produced a stream. */
  provider: string;
  modelId: string;
  routedVia: string;
  attempts: AttemptRecord[];
  fallbackCount: number;
  /** Async generator of OpenAI chunks; `usage` is set when the stream ends. */
  chunks: AsyncGenerator<ChatCompletionChunk>;
  /** Resolves with the final usage once the stream is fully consumed. */
  done: Promise<{ usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; latencyMs: number }>;
}

export async function executeChatStream(
  env: Env,
  req: AdapterRequest,
  auth: { unifiedKeyId: string | null },
): Promise<StreamOutcome> {
  const started = Date.now();
  const requestId = newId("req");
  const { candidates, profile } = await resolveCandidates(env, req.model);
  const maxAttempts = Math.max(1, Math.min(profile.retry_limit, 5));
  const attempts: AttemptRecord[] = [];
  // Prompt content is stored only when the admin explicitly enables it.
  const storePrompts = (await getSetting(env.DB, "store_prompts")) === "1";
  const promptText = storePrompts ? JSON.stringify(req.messages) : null;

  let usageResolve!: (v: { usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; latencyMs: number }) => void;
  const done = new Promise<{ usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; latencyMs: number }>(
    (resolve) => {
      usageResolve = resolve;
    },
  );

  for (let i = 0; i < Math.min(candidates.length, maxAttempts); i++) {
    const candidate = candidates[i];
    try {
      const adapter = getAdapter(candidate.provider, {
        baseUrlOverride: candidate.baseUrl,
        ai: env.AI,
      });
      const signal = AbortSignal.timeout(profile.timeout_ms);
      const gen = adapter.stream(candidate.decryptedKey, req, signal);
      // Probe the first chunk: if the adapter throws, fall through to the
      // next candidate. Peek by pulling one chunk, then re-yield it.
      const first = await gen.next();
      if (first.done) {
        throw upstreamError(502, "Upstream returned an empty stream", { retryable: true });
      }
      const routedVia = `${candidate.provider}/${candidate.model.model_id}`;
      let lastUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let responseText = "";
      const chunks: AsyncGenerator<ChatCompletionChunk> = (async function* () {
        yield first.value;
        if (first.value.usage) lastUsage = first.value.usage;
        responseText += first.value.choices[0]?.delta?.content ?? "";
        for await (const chunk of gen) {
          if (chunk.usage) lastUsage = chunk.usage;
          responseText += chunk.choices[0]?.delta?.content ?? "";
          yield chunk;
        }
        // Stream finished: log success.
        const latencyMs = Date.now() - started;
        await insertRequestLog(env.DB, {
          id: newId("att"),
          request_id: requestId,
          unified_key_id: auth.unifiedKeyId,
          provider: candidate.provider,
          model_id: candidate.model.model_id,
          status: "success",
          latency_ms: latencyMs,
          error_type: null,
          error_message: null,
          prompt_text: promptText,
          response_text: storePrompts ? responseText : null,
        });
        await insertUsageLog(env.DB, {
          id: requestId,
          unified_key_id: auth.unifiedKeyId,
          provider: candidate.provider,
          model_id: candidate.model.model_id,
          status: "success",
          prompt_tokens: lastUsage.prompt_tokens,
          completion_tokens: lastUsage.completion_tokens,
          latency_ms: latencyMs,
          routed_via: routedVia,
          fallback_count: attempts.length,
          error_type: null,
        });
        usageResolve({ usage: lastUsage, latencyMs });
      })();
      return {
        provider: candidate.provider,
        modelId: candidate.model.model_id,
        routedVia,
        attempts,
        fallbackCount: attempts.length,
        chunks,
        done,
      };
    } catch (err) {
      const apiErr = normalizeError(err);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model.model_id,
        error: apiErr.message,
      });
      await insertRequestLog(env.DB, {
        id: newId("att"),
        request_id: requestId,
        unified_key_id: auth.unifiedKeyId,
        provider: candidate.provider,
        model_id: candidate.model.model_id,
        status: "error",
        latency_ms: 0,
        error_type: apiErr.type,
        error_message: apiErr.message,
        prompt_text: promptText,
      });
      if (apiErr.status === 401 || apiErr.status === 403) {
        await updateProviderKey(env.DB, candidate.key.id, {
          status: "auth_failed",
          last_error: apiErr.message,
        });
      } else if (apiErr.retryable) {
        const backoff = parseBackoffSeconds({ bodyText: apiErr.message }) ?? 60;
        await setCooldown(env.KV, candidate.provider, candidate.key.id, backoff);
      } else {
        throw apiErr;
      }
      if (i >= Math.min(candidates.length, maxAttempts) - 1) break;
    }
  }
  await insertUsageLog(env.DB, {
    id: requestId,
    unified_key_id: auth.unifiedKeyId,
    provider: candidates[0]?.provider ?? "unknown",
    model_id: candidates[0]?.model.model_id ?? req.model,
    status: "error",
    prompt_tokens: 0,
    completion_tokens: 0,
    latency_ms: Date.now() - started,
    routed_via: null,
    fallback_count: attempts.length,
    error_type: "exhausted_error",
  });
  usageResolve({ usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, latencyMs: Date.now() - started });
  throw exhausted(attempts);
}
