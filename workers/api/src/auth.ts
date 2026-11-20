// FREE AI API HUB — authentication.
// Two systems, like the design: unified keys for /v1 (SHA-256 hash lookup)
// and admin sessions for /api/* (stateless HMAC tokens, 24 h).
// Original code for this project.

import type { Env } from "./env";
import { sha256Hex, timingSafeEqual, verifySessionToken } from "./lib/crypto";
import { getUnifiedKeyByHash, type UnifiedKeyRow } from "./lib/db";
import { unauthorized } from "./lib/errors";

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export function getSessionToken(request: Request): string | null {
  const bearer = getBearerToken(request);
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)fai_session=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Authenticate a unified gateway key (`fai_live_…`).
 * Returns the key row. Throws 401 for a missing, unknown, or revoked key.
 * The daily-limit and per-minute checks live in the rate limiter.
 */
export async function authenticateUnifiedKey(
  env: Env,
  request: Request,
): Promise<UnifiedKeyRow> {
  const token = getBearerToken(request);
  if (!token || !token.startsWith("fai_live_")) {
    throw unauthorized("Missing or malformed unified API key (expected Bearer fai_live_…)");
  }
  const hash = await sha256Hex(token);
  const row = await getUnifiedKeyByHash(env.DB, hash);
  if (!row) throw unauthorized("Invalid unified API key");
  // The hash lookup already proves equality; the extra compare guards
  // against a hash-collision / DB-tampering edge (defense in depth).
  if (!timingSafeEqual(row.key_hash, hash)) throw unauthorized("Invalid unified API key");
  if (row.revoked_at) throw unauthorized("This unified API key has been revoked");
  return row;
}

/** Authenticate an admin session. Returns the user id. Throws 401. */
export async function requireAdmin(env: Env, request: Request): Promise<string> {
  const token = getSessionToken(request);
  if (!token) throw unauthorized("Admin authentication required");
  const session = await verifySessionToken(token, env.SESSION_SECRET);
  if (!session) throw unauthorized("Admin session is invalid or expired");
  return session.userId;
}

/** Read the admin user id when present, without throwing (for optional auth). */
export async function optionalAdmin(env: Env, request: Request): Promise<string | null> {
  try {
    return await requireAdmin(env, request);
  } catch {
    return null;
  }
}
