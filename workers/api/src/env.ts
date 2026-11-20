// FREE AI API HUB — Worker environment bindings.
// The real Worker gets these from Wrangler (D1, KV, AI, secrets).
// Tests substitute fakes with the same shape (see test/d1.ts).
// Original code for this project.

import type { Ai, D1Database, KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  /** D1 database (all per-request writes go here). */
  DB: D1Database;
  /** KV namespace — cooldowns and config only, never per-request counters. */
  KV: KVNamespace;
  /** Workers AI binding (Cloudflare provider). Optional in tests. */
  AI?: Ai;
  /** Base64, 32 random bytes. AES-256-GCM key for provider keys. */
  ENCRYPTION_KEY: string;
  /** Random string for signing admin session tokens. */
  SESSION_SECRET: string;
  APP_NAME?: string;
  MAX_BODY_BYTES?: string;
  LOG_RETENTION_DAYS?: string;
}

/** Read a numeric env var with a default. */
export function envInt(env: Env, key: "MAX_BODY_BYTES" | "LOG_RETENTION_DAYS", fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
