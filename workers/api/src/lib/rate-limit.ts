// FREE AI API HUB — rate limiting (D1-backed, per unified key).
// KV writes are capped at 1,000/day, so per-request counters live in D1
// (usage_logs), not KV. Original code for this project.

import type { D1Database } from "@cloudflare/workers-types";
import { countKeyRequestsSince, countKeyRequestsToday } from "./db";
import { rateLimited } from "./errors";

export interface RateLimitConfig {
  /** Requests per minute per unified key (default 120). */
  rpm: number;
  /** Daily cap for the key (null = no cap). */
  dailyLimit: number | null;
}

/** Check a unified key against its per-minute and daily limits. Throws 429. */
export async function checkRateLimit(
  db: D1Database,
  keyId: string,
  config: RateLimitConfig,
): Promise<void> {
  if (config.dailyLimit !== null) {
    const today = await countKeyRequestsToday(db, keyId);
    if (today >= config.dailyLimit) {
      throw rateLimited(
        `Daily request limit of ${config.dailyLimit} reached for this key`,
        3600,
      );
    }
  }
  const lastMinute = await countKeyRequestsSince(db, keyId, 60);
  if (lastMinute >= config.rpm) {
    throw rateLimited(
      `Rate limit of ${config.rpm} requests per minute exceeded for this key`,
      60,
    );
  }
}
