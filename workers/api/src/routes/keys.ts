// FREE AI API HUB — provider key management.
// POST /v1/keys validates the key LIVE before storing anything; a failed
// validation returns the upstream error and stores nothing. Keys are
// encrypted at rest and only ever shown masked.
// Original code for this project.

import type { Env } from "../env";
import { requireAdmin } from "../auth";
import { decryptSecret, encryptSecret, maskKey } from "../lib/crypto";
import { ApiError, toErrorResponse } from "../lib/errors";
import {
  deleteProviderKey,
  getModelByProviderAndId,
  getProviderKey,
  insertProviderKey,
  listModels,
  listProviderKeys,
  newId,
  setModelVerified,
  setProviderStatus,
  updateProviderKey,
  upsertModel,
} from "../lib/db";
import { cloudflareDohResolver, validateProviderUrl } from "../lib/ssrf";
import { validateProviderKeyInput } from "../lib/validate";
import { getAdapter, getProviderDef } from "../adapters/registry";
import type { ProviderKeyInfo } from "@free-ai-api-hub/shared";

function toInfo(row: Awaited<ReturnType<typeof getProviderKey>>): ProviderKeyInfo | null {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    key_masked: row.key_masked,
    priority: row.priority,
    enabled: row.enabled === 1,
    status: row.status as ProviderKeyInfo["status"],
    last_tested_at: row.last_tested_at,
    last_error: row.last_error,
    created_at: row.created_at,
  };
}

/** Pick a real model id to probe with (user-provided, else first catalog row). */
async function probeModelFor(env: Env, provider: string, modelId?: string): Promise<string | null> {
  if (modelId) {
    const row = await getModelByProviderAndId(env.DB, provider, modelId);
    if (row) return row.model_id;
    return modelId; // custom model not in the catalog yet; probe it directly
  }
  const models = await listModels(env.DB);
  const first = models.find((m) => m.provider === provider && m.enabled === 1);
  return first ? first.model_id : null;
}

/**
 * POST /v1/keys — add a provider key (admin auth).
 * Live-validates first; stores nothing on failure.
 */
export async function handleAddProviderKey(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const body = await request.json().catch(() => null);
    const input = validateProviderKeyInput(body);
    const def = getProviderDef(input.provider);
    if (!def && input.provider !== "custom") {
      throw new ApiError(400, "invalid_request_error", `Unknown provider: ${input.provider}`);
    }

    // Custom providers: validate the base URL (SSRF guard, with DNS check).
    if (input.provider === "custom" && input.base_url) {
      const check = await validateProviderUrl(input.base_url, {
        resolver: cloudflareDohResolver(),
      });
      if (!check.ok) {
        throw new ApiError(400, "invalid_request_error", `Unsafe provider URL: ${check.reason}`);
      }
    }

    const isKeyless = def?.keyless === true;
    const probeModel = await probeModelFor(env, input.provider, input.model_id);

    // Live validation (skipped for keyless providers — the binding is the credential).
    if (!isKeyless) {
      const adapter = getAdapter(input.provider, {
        baseUrlOverride: input.base_url ?? undefined,
        ai: env.AI,
      });
      const result = await adapter.validateKey(input.key, probeModel ?? undefined);
      if (!result.valid) {
        throw new ApiError(
          400,
          "invalid_request_error",
          `Key validation failed: ${result.error ?? "upstream rejected the key"}`,
        );
      }
    }

    // For a custom provider with a new model id, add the catalog row first.
    if (input.provider === "custom" && input.model_id) {
      await upsertModel(env.DB, {
        id: `model-custom-${input.model_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        provider: "custom",
        model_id: input.model_id,
        display_name: input.model_id,
        capabilities: '["chat"]',
        context_window: null,
        supports_streaming: 1,
        supports_tools: 0,
        supports_vision: 0,
        free_tier: 1,
        verified: 0,
        last_verified_at: null,
        last_error: null,
        enabled: 1,
      });
    }

    const encrypted = isKeyless
      ? { ciphertext: "", iv: "", tag: "" }
      : await encryptSecret(input.key, env.ENCRYPTION_KEY);
    const id = newId("pk");
    await insertProviderKey(env.DB, {
      id,
      provider: input.provider,
      label: input.label ?? null,
      key_encrypted: encrypted.ciphertext,
      key_iv: encrypted.iv,
      key_tag: encrypted.tag,
      key_version: 1,
      key_masked: isKeyless ? "keyless (Workers AI binding)" : maskKey(input.key),
      priority: input.priority ?? 100,
      enabled: 1,
      status: "healthy",
      last_tested_at: new Date().toISOString(),
      last_error: null,
      base_url: input.base_url ?? null,
      model_id: input.model_id ?? null,
    });
    await setProviderStatus(env.DB, input.provider, "operational");
    if (probeModel) {
      const row = await getModelByProviderAndId(env.DB, input.provider, probeModel);
      if (row) await setModelVerified(env.DB, row.id, true);
    }
    const created = await getProviderKey(env.DB, id);
    return new Response(JSON.stringify({ key: toInfo(created) }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** DELETE /v1/keys/:id — remove a provider key (admin auth). */
export async function handleDeleteProviderKey(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const row = await getProviderKey(env.DB, id);
    if (!row) throw new ApiError(404, "not_found_error", `No provider key with id ${id}`);
    await deleteProviderKey(env.DB, id);
    // Clear any KV cooldowns for this key.
    const listed = await env.KV.list({ prefix: `cooldown:${row.provider}:${id}` });
    for (const entry of listed.keys) await env.KV.delete(entry.name);
    const remaining = await listProviderKeys(env.DB, false);
    if (!remaining.some((k) => k.provider === row.provider)) {
      await setProviderStatus(env.DB, row.provider, "not_configured");
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** GET /api/keys — admin list of provider keys (masked). */
export async function handleAdminListKeys(env: Env, request: Request): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const rows = await listProviderKeys(env.DB, false);
    const keys = rows.map((r) => toInfo(r)).filter((x): x is ProviderKeyInfo => x !== null);
    return new Response(JSON.stringify({ keys }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** PATCH /api/keys/:id — admin update label / priority / enabled. */
export async function handleAdminUpdateKey(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "invalid_request_error", "Request body must be a JSON object");
    const patch: Parameters<typeof updateProviderKey>[2] = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.priority === "number" && Number.isFinite(body.priority)) {
      patch.priority = Math.max(0, Math.floor(body.priority));
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled ? 1 : 0;
    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, "invalid_request_error", "Nothing to update");
    }
    await updateProviderKey(env.DB, id, patch);
    const updated = await getProviderKey(env.DB, id);
    return new Response(JSON.stringify({ key: toInfo(updated) }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}

/** POST /api/keys/:id/test — re-validate a stored key (admin auth). */
export async function handleAdminTestKey(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  try {
    await requireAdmin(env, request);
    const row = await getProviderKey(env.DB, id);
    if (!row) throw new ApiError(404, "not_found_error", `No provider key with id ${id}`);
    const def = getProviderDef(row.provider);
    if (def?.keyless) {
      await updateProviderKey(env.DB, id, { status: "healthy", last_tested_at: new Date().toISOString(), last_error: null });
      return new Response(JSON.stringify({ valid: true, keyless: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    const decrypted = await decryptSecret(
      { ciphertext: row.key_encrypted, iv: row.key_iv, tag: row.key_tag },
      env.ENCRYPTION_KEY,
    );
    const probeModel = await probeModelFor(env, row.provider, row.model_id ?? undefined);
    const adapter = getAdapter(row.provider, { baseUrlOverride: row.base_url, ai: env.AI });
    const result = await adapter.validateKey(decrypted, probeModel ?? undefined);
    await updateProviderKey(env.DB, id, {
      status: result.valid ? "healthy" : "error",
      last_tested_at: new Date().toISOString(),
      last_error: result.valid ? null : (result.error ?? "validation failed"),
    });
    if (result.valid) {
      await setProviderStatus(env.DB, row.provider, "operational");
      if (probeModel) {
        const modelRow = await getModelByProviderAndId(env.DB, row.provider, probeModel);
        if (modelRow) await setModelVerified(env.DB, modelRow.id, true);
      }
    }
    return new Response(JSON.stringify({ valid: result.valid, error: result.error ?? null }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ApiError) return toErrorResponse(err);
    return toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
  }
}
