// FREE AI API HUB — admin endpoints: auth (first-run setup + login),
// routing profiles, settings, and the config export.
// Original code for this project.

import type { Env } from "../env";
import { requireAdmin } from "../auth";
import {
  createSessionToken,
  hashPassword,
  verifyPassword,
} from "../lib/crypto";
import { ApiError, toErrorResponse } from "../lib/errors";
import {
  countUsers,
  createUser,
  deleteProfile,
  getProfile,
  getProfileModelIds,
  getSetting,
  getUserByEmail,
  listProfiles,
  listProviderKeys,
  listUnifiedKeys,
  newId,
  setSetting,
  upsertProfile,
  type RoutingProfileRow,
} from "../lib/db";
import {
  validateProfileInput,
  validateSettingsInput,
} from "../lib/validate";
import type { RoutingProfile, RouterStrategy } from "@free-ai-api-hub/shared";

function sessionCookie(token: string, maxAgeSeconds: number): string {
  // Secure: the dashboard is served over HTTPS in production. The frontend
  // also keeps the token in sessionStorage and sends it as a Bearer header,
  // so the cookie is a fallback, not the only path.
  return `fai_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; Secure`;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_request_error", "Request body must be a JSON object");
  }
  return body;
}

/**
 * POST /api/auth/setup — create the first admin account. Only works when
 * no admin exists yet; afterwards it is rejected (use login).
 */
export async function handleSetup(env: Env, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !email.includes("@")) {
      throw new ApiError(400, "invalid_request_error", "A valid `email` is required");
    }
    if (password.length < 12) {
      throw new ApiError(400, "invalid_request_error", "Password must be at least 12 characters");
    }
    if ((await countUsers(env.DB)) > 0) {
      throw new ApiError(409, "invalid_request_error", "An admin account already exists");
    }
    const hash = await hashPassword(password);
    const id = newId("usr");
    await createUser(env.DB, id, email, hash);
    const token = await createSessionToken(id, env.SESSION_SECRET);
    return new Response(JSON.stringify({ ok: true, email, token }), {
      status: 201,
      headers: { "content-type": "application/json", "set-cookie": sessionCookie(token, 86400) },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** POST /api/auth/login — email + password → session token. */
export async function handleLogin(env: Env, request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      throw new ApiError(400, "invalid_request_error", "`email` and `password` are required");
    }
    const user = await getUserByEmail(env.DB, email);
    if (!user) {
      throw new ApiError(401, "authentication_error", "Invalid email or password");
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      throw new ApiError(401, "authentication_error", "Invalid email or password");
    }
    const token = await createSessionToken(user.id, env.SESSION_SECRET);
    return new Response(JSON.stringify({ ok: true, email: user.email, token }), {
      headers: { "content-type": "application/json", "set-cookie": sessionCookie(token, 86400) },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** POST /api/auth/logout — clears the session cookie. */
export async function handleLogout(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": sessionCookie("", 0),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/auth/me — who is signed in (admin auth). */
export async function handleMe(env: Env, request: Request): Promise<Response> {
  try {
    const adminId = await requireAdmin(env, request);
    const rows = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
      .bind(adminId)
      .all<{ email: string }>();
    const email = rows.results[0]?.email ?? "";
    return new Response(JSON.stringify({ ok: true, email }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

async function profileRowToInfo(env: Env, row: RoutingProfileRow): Promise<RoutingProfile> {
  const tableIds = await getProfileModelIds(env.DB, row.id);
  // profile_models stores the models table `id`; the API returns the
  // `model_id` strings so clients can use them directly, in chain order.
  const resolved: string[] = [];
  if (tableIds.length > 0) {
    const rows = await env.DB.prepare(
      `SELECT id, model_id FROM models WHERE id IN (${tableIds.map(() => "?").join(",")})`,
    )
      .bind(...tableIds)
      .all<{ id: string; model_id: string }>();
    const idToModel = new Map((rows.results ?? []).map((r) => [r.id, r.model_id]));
    for (const id of tableIds) {
      const modelId = idToModel.get(id);
      resolved.push(modelId ?? id); // model row missing — keep the stored value
    }
  }
  return {
    id: row.id,
    name: row.name,
    strategy: row.strategy as RouterStrategy,
    retry_limit: row.retry_limit,
    timeout_ms: row.timeout_ms,
    cooldown_ms: row.cooldown_ms,
    is_default: row.is_default === 1,
    models: resolved,
  };
}

/** GET /api/profiles — list routing profiles (admin). */
export async function handleListProfiles(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const rows = await listProfiles(env.DB);
    const profiles: RoutingProfile[] = [];
    for (const row of rows) profiles.push(await profileRowToInfo(env, row));
    return new Response(JSON.stringify({ profiles }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/**
 * Resolve model ids (the strings clients send, e.g. "gemini-2.5-flash")
 * to models table ids for profile_models storage.
 */
async function resolveModelTableIds(env: Env, modelIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const modelId of modelIds) {
    const row = await env.DB.prepare("SELECT id FROM models WHERE model_id = ?")
      .bind(modelId)
      .first<{ id: string }>();
    out.push(row?.id ?? modelId);
  }
  return out;
}

/** POST /api/profiles — create a routing profile (admin). */
export async function handleCreateProfile(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const body = await readJson(request);
    const input = validateProfileInput(body);
    const isDefault = body.is_default === true;
    const id = newId("prof");
    const tableIds = await resolveModelTableIds(env, input.models);
    await upsertProfile(
      env.DB,
      {
        id,
        name: input.name,
        strategy: input.strategy,
        retry_limit: input.retry_limit,
        timeout_ms: input.timeout_ms,
        cooldown_ms: input.cooldown_ms,
        is_default: isDefault ? 1 : 0,
      },
      tableIds,
    );
    return new Response(JSON.stringify({ ok: true, id }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** PUT /api/profiles/:id — update a routing profile (admin). */
export async function handleUpdateProfile(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const existing = await getProfile(env.DB, id);
    if (!existing) throw new ApiError(404, "not_found_error", `No profile with id ${id}`);
    const body = await readJson(request);
    const input = validateProfileInput(body);
    const isDefault =
      typeof body.is_default === "boolean" ? body.is_default : existing.is_default === 1;
    const tableIds = await resolveModelTableIds(env, input.models);
    await upsertProfile(
      env.DB,
      {
        id,
        name: input.name,
        strategy: input.strategy,
        retry_limit: input.retry_limit,
        timeout_ms: input.timeout_ms,
        cooldown_ms: input.cooldown_ms,
        is_default: isDefault ? 1 : 0,
      },
      tableIds,
    );
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** DELETE /api/profiles/:id — delete a routing profile (admin). */
export async function handleDeleteProfile(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const target = await getProfile(env.DB, id);
    if (!target) throw new ApiError(404, "not_found_error", `No profile with id ${id}`);
    if (target.is_default === 1) {
      throw new ApiError(400, "invalid_request_error", "Cannot delete the default profile");
    }
    await deleteProfile(env.DB, id);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

const SETTING_KEYS = ["store_prompts", "log_retention_days", "rate_limit_rpm"] as const;

/** GET /api/settings — admin settings. */
export async function handleGetSettings(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const out: Record<string, string | null> = {};
    for (const key of SETTING_KEYS) out[key] = await getSetting(env.DB, key);
    return new Response(JSON.stringify({ settings: out }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** PATCH /api/settings — update settings (admin). */
export async function handleUpdateSettings(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const body = await readJson(request);
    const input = validateSettingsInput(body);
    for (const [key, value] of Object.entries(input)) {
      await setSetting(env.DB, key, value);
    }
    return new Response(JSON.stringify({ ok: true, settings: input }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/**
 * GET /api/export — download an encrypted config export (admin).
 * Provider keys stay encrypted (ciphertext only, no decryption key);
 * unified keys are never exported. The export is a JSON file with the
 * config needed to rebuild this instance, not a secrets dump.
 */
export async function handleExport(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const keys = await listProviderKeys(env.DB, false);
    const profiles = await listProfiles(env.DB);
    const profileInfos: RoutingProfile[] = [];
    for (const row of profiles) profileInfos.push(await profileRowToInfo(env, row));
    const unified = await listUnifiedKeys(env.DB);
    const settings: Record<string, string | null> = {};
    for (const key of SETTING_KEYS) settings[key] = await getSetting(env.DB, key);
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      provider_keys: keys.map((k) => ({
        provider: k.provider,
        label: k.label,
        priority: k.priority,
        enabled: k.enabled === 1,
        status: k.status,
        base_url: k.base_url,
        model_id: k.model_id,
        // Encrypted ciphertext — useless without the ENCRYPTION_KEY secret.
        key_encrypted: k.key_encrypted,
        key_iv: k.key_iv,
        key_tag: k.key_tag,
        key_version: k.key_version,
        key_masked: k.key_masked,
      })),
      profiles: profileInfos,
      unified_keys: unified.map((u) => ({
        name: u.name,
        prefix: u.prefix,
        daily_limit: u.daily_limit,
        created_at: u.created_at,
        // Hashes and full keys are never exported.
      })),
      settings,
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="free-ai-api-hub-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
