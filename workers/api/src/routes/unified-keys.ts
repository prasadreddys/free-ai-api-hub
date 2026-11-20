// FREE AI API HUB — unified gateway key management (admin only).
// Keys are generated as `fai_live_…`, stored as SHA-256 hashes, shown once
// at creation, and never expose provider keys.
// Original code for this project.

import type { Env } from "../env";
import { requireAdmin } from "../auth";
import {
  generateUnifiedKey,
  sha256Hex,
} from "../lib/crypto";
import { ApiError, toErrorResponse } from "../lib/errors";
import {
  insertUnifiedKey,
  listUnifiedKeys,
  newId,
  revokeUnifiedKey,
} from "../lib/db";
import type { UnifiedKeyInfo } from "@free-ai-api-hub/shared";

function toInfo(row: Awaited<ReturnType<typeof listUnifiedKeys>>[number]): UnifiedKeyInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    request_count: row.request_count,
    daily_limit: row.daily_limit,
    revoked: row.revoked_at !== null,
  };
}

/** POST /api/unified-keys — create a unified key (admin). Returns it ONCE. */
export async function handleCreateUnifiedKey(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      daily_limit?: unknown;
    } | null;
    if (!body || typeof body.name !== "string" || body.name.trim() === "") {
      throw new ApiError(400, "invalid_request_error", "`name` is required");
    }
    let dailyLimit: number | null = null;
    if (body.daily_limit !== undefined && body.daily_limit !== null) {
      if (typeof body.daily_limit !== "number" || !Number.isFinite(body.daily_limit)) {
        throw new ApiError(400, "invalid_request_error", "`daily_limit` must be a number");
      }
      dailyLimit = Math.max(1, Math.floor(body.daily_limit));
    }
    const key = generateUnifiedKey();
    const hash = await sha256Hex(key);
    const id = newId("uk");
    await insertUnifiedKey(env.DB, {
      id,
      name: body.name.trim(),
      key_hash: hash,
      prefix: key.slice(0, 13),
      daily_limit: dailyLimit,
    });
    return new Response(
      JSON.stringify({
        // The full key is returned exactly once. It is never stored.
        key,
        info: {
          id,
          name: body.name.trim(),
          prefix: key.slice(0, 13),
          daily_limit: dailyLimit,
          created_at: new Date().toISOString(),
        },
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/unified-keys — list unified keys (metadata only, never the keys). */
export async function handleListUnifiedKeys(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const rows = await listUnifiedKeys(env.DB);
    return new Response(JSON.stringify({ keys: rows.map(toInfo) }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** DELETE /api/unified-keys/:id — revoke a unified key (admin). */
export async function handleRevokeUnifiedKey(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    await revokeUnifiedKey(env.DB, id);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** POST /api/unified-keys/:id/rotate — revoke the old key, issue a new one. */
export async function handleRotateUnifiedKey(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  try {
    const adminId = await requireAdmin(env, request);
    void adminId;
    const rows = await listUnifiedKeys(env.DB);
    const old = rows.find((r) => r.id === id);
    if (!old) throw new ApiError(404, "not_found_error", `No unified key with id ${id}`);
    if (old.revoked_at) {
      throw new ApiError(400, "invalid_request_error", "Cannot rotate a revoked key");
    }
    const key = generateUnifiedKey();
    const hash = await sha256Hex(key);
    const newIdValue = newId("uk");
    await insertUnifiedKey(env.DB, {
      id: newIdValue,
      name: old.name,
      key_hash: hash,
      prefix: key.slice(0, 13),
      daily_limit: old.daily_limit,
    });
    await revokeUnifiedKey(env.DB, id);
    return new Response(
      JSON.stringify({
        key,
        info: {
          id: newIdValue,
          name: old.name,
          prefix: key.slice(0, 13),
          daily_limit: old.daily_limit,
        },
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
