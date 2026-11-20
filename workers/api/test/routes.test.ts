// FREE AI API HUB — route handler tests (auth, models, usage, keys,
// unified keys, rate limiting, SSRF on custom providers).

import { describe, expect, it, vi, afterEach } from "vitest";
import { handleListModels } from "../src/routes/models";
import { handleUsage } from "../src/routes/usage";
import { handleListProviders } from "../src/routes/providers";
import { handleAddProviderKey, handleDeleteProviderKey } from "../src/routes/keys";
import {
  handleCreateUnifiedKey,
  handleListUnifiedKeys,
  handleRevokeUnifiedKey,
  handleRotateUnifiedKey,
} from "../src/routes/unified-keys";
import { handleLogin, handleSetup } from "../src/routes/admin";
import { handleChatCompletion } from "../src/routes/chat";
import { handleTest } from "../src/routes/test";
import {
  dohResponse,
  geminiResponse,
  jsonRequest,
  makeEnv,
  openAiChatResponse,
  seedAdmin,
  seedProviderKey,
  seedUnifiedKey,
} from "./setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

describe("GET /v1/models", () => {
  it("lists the seeded catalog with honest availability (nothing verified yet)", async () => {
    const { env } = makeEnv();
    const unifiedKey = await seedUnifiedKey(env);
    const req = new Request("https://gateway.test/v1/models", {
      headers: authHeader(unifiedKey),
    });
    const res = await handleListModels(env, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      data: { id: string; available: boolean; verified: boolean }[];
    };
    expect(body.object).toBe("list");
    expect(body.data.length).toBe(22);
    // No keys exist, so nothing is available — honest, not fabricated.
    expect(body.data.every((m) => m.available === false)).toBe(true);
    expect(body.data.some((m) => m.id === "gemini-2.5-flash")).toBe(true);
  });

  it("marks a model available once its provider has a healthy key and is verified", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "gemini", "gemini-test-PLACEHOLDER");
    await env.DB.prepare(
      "UPDATE models SET verified = 1, last_verified_at = datetime('now') WHERE model_id = 'gemini-2.5-flash'",
    ).run();
    const unifiedKey = await seedUnifiedKey(env);
    const req = new Request("https://gateway.test/v1/models", {
      headers: authHeader(unifiedKey),
    });
    const res = await handleListModels(env, req);
    const body = (await res.json()) as {
      data: { id: string; available: boolean }[];
    };
    const flash = body.data.find((m) => m.id === "gemini-2.5-flash");
    expect(flash?.available).toBe(true);
  });

  it("requires a unified key", async () => {
    const { env } = makeEnv();
    const req = new Request("https://gateway.test/v1/models");
    const res = await handleListModels(env, req);
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/usage", () => {
  it("returns honest zeros for a fresh key", async () => {
    const { env } = makeEnv();
    const unifiedKey = await seedUnifiedKey(env);
    const req = new Request("https://gateway.test/v1/usage?window=24h", {
      headers: authHeader(unifiedKey),
    });
    const res = await handleUsage(env, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_requests: number;
      total_tokens: number;
      by_provider: Record<string, unknown>;
    };
    expect(body.total_requests).toBe(0);
    expect(body.total_tokens).toBe(0);
    expect(body.by_provider).toEqual({});
  });
});

describe("GET /v1/providers", () => {
  it("reports not_configured for every provider with no keys", async () => {
    const { env } = makeEnv();
    const unifiedKey = await seedUnifiedKey(env);
    const req = new Request("https://gateway.test/v1/providers", {
      headers: authHeader(unifiedKey),
    });
    const res = await handleListProviders(env, req);
    const body = (await res.json()) as {
      providers: { id: string; status: string }[];
    };
    expect(body.providers.length).toBe(8);
    expect(body.providers.every((p) => p.status === "not_configured")).toBe(true);
    // Held providers are never listed.
    expect(body.providers.some((p) => ["cohere", "zai", "nvidia"].includes(p.id))).toBe(false);
  });
});

describe("POST /v1/keys", () => {
  it("validates the key live, then stores it encrypted and masked", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) return geminiResponse("ok");
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const req = jsonRequest(
      "https://gateway.test/v1/keys",
      { provider: "gemini", key: "gemini-test-PLACEHOLDER-1234", label: "My Gemini key" },
      authHeader(admin.token),
    );
    const res = await handleAddProviderKey(env, req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      key: { provider: string; key_masked: string; status: string };
    };
    expect(body.key.provider).toBe("gemini");
    expect(body.key.key_masked).toBe("gemi…1234");
    expect(body.key.status).toBe("healthy");
    // The stored value is ciphertext, not the key.
    const row = await env.DB.prepare(
      "SELECT key_encrypted FROM provider_keys WHERE provider = 'gemini'",
    ).first<{ key_encrypted: string }>();
    expect(row?.key_encrypted).not.toContain("gemini-test-PLACEHOLDER-1234");
    // The probed model was marked verified.
    const model = await env.DB.prepare(
      "SELECT verified FROM models WHERE model_id = 'gemini-2.5-flash'",
    ).first<{ verified: number }>();
    expect(model?.verified).toBe(1);
  });

  it("stores nothing when live validation fails", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "API key not valid" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const req = jsonRequest(
      "https://gateway.test/v1/keys",
      { provider: "gemini", key: "bad-key" },
      authHeader(admin.token),
    );
    const res = await handleAddProviderKey(env, req);
    expect(res.status).toBe(400);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_keys").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("refuses a held provider (Cohere)", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    const req = jsonRequest(
      "https://gateway.test/v1/keys",
      { provider: "cohere", key: "some-key" },
      authHeader(admin.token),
    );
    const res = await handleAddProviderKey(env, req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/held/i);
  });

  it("rejects a custom provider with a private base URL (SSRF)", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    const req = jsonRequest(
      "https://gateway.test/v1/keys",
      { provider: "custom", key: "k", base_url: "https://169.254.169.254/v1", model_id: "m" },
      authHeader(admin.token),
    );
    const res = await handleAddProviderKey(env, req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/unsafe|private|loopback|link-local/i);
  });

  it("accepts a custom provider with a public base URL (mocked DNS)", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("cloudflare-dns.com")) return dohResponse(["93.184.216.34"]);
        if (url.includes("api.example.com")) return openAiChatResponse("ok");
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const req = jsonRequest(
      "https://gateway.test/v1/keys",
      { provider: "custom", key: "custom-key-PLACEHOLDER", base_url: "https://api.example.com/v1", model_id: "test-model" },
      authHeader(admin.token),
    );
    const res = await handleAddProviderKey(env, req);
    expect(res.status).toBe(201);
  });

  it("requires admin auth", async () => {
    const { env } = makeEnv();
    const req = jsonRequest("https://gateway.test/v1/keys", { provider: "gemini", key: "x" });
    const res = await handleAddProviderKey(env, req);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /v1/keys/:id", () => {
  it("removes the key and clears its cooldowns", async () => {
    const { env, kv } = makeEnv();
    const admin = await seedAdmin(env);
    const id = await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    await kv.put("cooldown:groq:" + id, "1", { expirationTtl: 60 });
    const req = new Request(`https://gateway.test/v1/keys/${id}`, {
      method: "DELETE",
      headers: authHeader(admin.token),
    });
    const res = await handleDeleteProviderKey(env, req, id);
    expect(res.status).toBe(200);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_keys").first<{ n: number }>();
    expect(count?.n).toBe(0);
    expect(await kv.get("cooldown:groq:" + id)).toBeNull();
  });
});

describe("unified keys", () => {
  it("creates a key, shows it once, and lists only metadata", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    const createReq = jsonRequest(
      "https://gateway.test/api/unified-keys",
      { name: "My app", daily_limit: 1000 },
      authHeader(admin.token),
    );
    const createRes = await handleCreateUnifiedKey(env, createReq);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { key: string; info: { prefix: string } };
    expect(created.key).toMatch(/^fai_live_/);
    // The list never returns the full key.
    const listReq = new Request("https://gateway.test/api/unified-keys", {
      headers: authHeader(admin.token),
    });
    const listRes = await handleListUnifiedKeys(env, listReq);
    const listed = (await listRes.json()) as { keys: { name: string; prefix: string }[] };
    expect(listed.keys).toHaveLength(1);
    expect(listed.keys[0].name).toBe("My app");
    expect(JSON.stringify(listed)).not.toContain(created.key);
    // The created key authenticates (503 = no provider keys, not 401).
    const chatReq = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hi" }],
    }, authHeader(created.key));
    const chatRes = await handleChatCompletion(env, chatReq);
    expect(chatRes.status).toBe(503);
  });

  it("revokes a key and it stops authenticating", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    const key = await seedUnifiedKey(env);
    const row = await env.DB.prepare("SELECT id FROM unified_api_keys").first<{ id: string }>();
    const revokeReq = new Request(`https://gateway.test/api/unified-keys/${row?.id}`, {
      method: "DELETE",
      headers: authHeader(admin.token),
    });
    const revokeRes = await handleRevokeUnifiedKey(env, revokeReq, row?.id ?? "");
    expect(revokeRes.status).toBe(200);
    const chatReq = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hi" }],
    }, authHeader(key));
    const chatRes = await handleChatCompletion(env, chatReq);
    expect(chatRes.status).toBe(401);
  });

  it("rotates a key: the old one dies, the new one works", async () => {
    const { env } = makeEnv();
    const admin = await seedAdmin(env);
    const oldKey = await seedUnifiedKey(env);
    const row = await env.DB.prepare("SELECT id FROM unified_api_keys").first<{ id: string }>();
    const rotateReq = new Request(`https://gateway.test/api/unified-keys/${row?.id}/rotate`, {
      method: "POST",
      headers: authHeader(admin.token),
    });
    const rotateRes = await handleRotateUnifiedKey(env, rotateReq, row?.id ?? "");
    expect(rotateRes.status).toBe(201);
    const rotated = (await rotateRes.json()) as { key: string };
    expect(rotated.key).toMatch(/^fai_live_/);
    expect(rotated.key).not.toBe(oldKey);
    // Old key is dead.
    const oldReq = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hi" }],
    }, authHeader(oldKey));
    expect((await handleChatCompletion(env, oldReq)).status).toBe(401);
    // New key passes auth (503 = no provider keys, not 401).
    const newReq = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hi" }],
    }, authHeader(rotated.key));
    expect((await handleChatCompletion(env, newReq)).status).toBe(503);
  });
});

describe("admin auth", () => {
  it("setup creates the first admin and login works afterwards", async () => {
    const { env } = makeEnv();
    const setupReq = jsonRequest("https://gateway.test/api/auth/setup", {
      email: "admin@example.com",
      password: "correct-horse-battery-staple",
    });
    const setupRes = await handleSetup(env, setupReq);
    expect(setupRes.status).toBe(201);
    const setupBody = (await setupRes.json()) as { token: string };
    expect(setupBody.token).toBeTruthy();

    const loginReq = jsonRequest("https://gateway.test/api/auth/login", {
      email: "admin@example.com",
      password: "correct-horse-battery-staple",
    });
    const loginRes = await handleLogin(env, loginReq);
    expect(loginRes.status).toBe(200);

    const badReq = jsonRequest("https://gateway.test/api/auth/login", {
      email: "admin@example.com",
      password: "wrong-password",
    });
    expect((await handleLogin(env, badReq)).status).toBe(401);
  });

  it("setup refuses a second admin", async () => {
    const { env } = makeEnv();
    await seedAdmin(env);
    const req = jsonRequest("https://gateway.test/api/auth/setup", {
      email: "second@example.com",
      password: "correct-horse-battery-staple",
    });
    const res = await handleSetup(env, req);
    expect(res.status).toBe(409);
  });

  it("setup refuses a short password", async () => {
    const { env } = makeEnv();
    const req = jsonRequest("https://gateway.test/api/auth/setup", {
      email: "admin@example.com",
      password: "short",
    });
    const res = await handleSetup(env, req);
    expect(res.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("429s when the key exceeds the per-minute limit", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    // Seed 120 completed requests in the last minute for this key.
    const row = await env.DB.prepare("SELECT id FROM unified_api_keys").first<{ id: string }>();
    for (let i = 0; i < 120; i++) {
      await env.DB.prepare(
        "INSERT INTO usage_logs (id, unified_key_id, provider, model_id, status, prompt_tokens, completion_tokens, latency_ms, routed_via, fallback_count, created_at) VALUES (?, ?, 'groq', 'llama-3.3-70b-versatile', 'success', 10, 5, 100, 'groq/llama-3.3-70b-versatile', 0, datetime('now'))",
      )
        .bind(`seed-${i}`, row?.id)
        .run();
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openAiChatResponse("should not be reached")),
    );
    const req = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hello" }],
    }, authHeader(unifiedKey));
    const res = await handleChatCompletion(env, req);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/rate limit/i);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /v1/test", () => {
  it("tests a stored key and reports latency", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "gemini", "gemini-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) return geminiResponse("ok");
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const req = jsonRequest(
      "https://gateway.test/v1/test",
      { provider: "gemini", model: "gemini-2.5-flash" },
      authHeader(unifiedKey),
    );
    const res = await handleTest(env, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; latency_ms: number; provider: string };
    expect(body.valid).toBe(true);
    expect(body.provider).toBe("gemini");
    expect(body.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("reports invalid when the stored key is rejected", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "gemini", "bad-key");
    const unifiedKey = await seedUnifiedKey(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "API key not valid" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const req = jsonRequest(
      "https://gateway.test/v1/test",
      { provider: "gemini", model: "gemini-2.5-flash" },
      authHeader(unifiedKey),
    );
    const res = await handleTest(env, req);
    const body = (await res.json()) as { valid: boolean; error: string };
    expect(body.valid).toBe(false);
    expect(body.error).toMatch(/API key not valid/);
  });
});
