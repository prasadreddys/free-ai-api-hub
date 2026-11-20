// FREE AI API HUB — test helpers.
// A fake D1 backed by node:sqlite (D1 IS SQLite, so the real migration
// SQL and the real queries run), a Map-backed fake KV, and seed helpers.
// All upstreams are mocked via a stubbed global fetch — no real network.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../src/env";
import { createSessionToken, hashPassword } from "../src/lib/crypto";
import { encryptSecret, generateUnifiedKey, maskKey, sha256Hex } from "../src/lib/crypto";
import { createUser, insertProviderKey, insertUnifiedKey, newId } from "../src/lib/db";

// ---------------------------------------------------------------------------
// Fake D1 (SQLite-backed)
// ---------------------------------------------------------------------------

export class FakeD1 {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    // Migrations live at the repo root (wrangler.toml sits there too).
    const dir = join(process.cwd(), "..", "..", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      this.db.exec(readFileSync(join(dir, f), "utf8"));
    }
  }

  prepare(sql: string) {
    const self = this;
    const makeStmt = (params: unknown[]) => ({
      async run() {
        const stmt = self.db.prepare(sql);
        const info = stmt.run(...(params as never[]));
        return {
          success: true,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid),
            duration: 0,
          },
        };
      },
      async all<T = Record<string, unknown>>() {
        const stmt = self.db.prepare(sql);
        const results = stmt.all(...(params as never[])) as unknown as T[];
        return { success: true, results, meta: { duration: 0 } };
      },
      async first<T = Record<string, unknown>>() {
        const stmt = self.db.prepare(sql);
        const row = stmt.get(...(params as never[])) as unknown as T | undefined;
        return (row ?? null) as T | null;
      },
    });
    return {
      bind: (...params: unknown[]) => makeStmt(params),
      ...makeStmt([]),
    };
  }

  batch(): never {
    throw new Error("FakeD1.batch is not implemented (unused by the gateway)");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }
}

// ---------------------------------------------------------------------------
// Fake KV (Map-backed)
// ---------------------------------------------------------------------------

export class FakeKV {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string, type?: "text" | "json"): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    if (type === "json") return JSON.parse(entry.value) as unknown as string;
    return entry.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = opts?.prefix ?? "";
    const keys = [...this.store.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys };
  }

  /** Test helper: read the raw stored value. */
  raw(key: string): string | undefined {
    return this.store.get(key)?.value;
  }
}

// ---------------------------------------------------------------------------
// Fake Workers AI binding
// ---------------------------------------------------------------------------

export function makeFakeAi(response = "Hello from Workers AI") {
  return {
    run: async (_model: string, _input: Record<string, unknown>) => ({
      response,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
  };
}

// ---------------------------------------------------------------------------
// Env factory
// ---------------------------------------------------------------------------

/** Base64 of the 32 ASCII bytes "test-encryption-key-0123456789ab". */
export const TEST_ENCRYPTION_KEY = "dGVzdC1lbmNyeXB0aW9uLWtleS0wMTIzNDU2Nzg5YWI=";
export const TEST_SESSION_SECRET = "test-session-secret-0123456789abcdef";

export function makeEnv(overrides: Partial<Env> = {}): { env: Env; db: FakeD1; kv: FakeKV } {
  const db = new FakeD1();
  const kv = new FakeKV();
  const env = {
    DB: db as unknown as D1Database,
    KV: kv as unknown as KVNamespace,
    AI: makeFakeAi() as unknown as Ai,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    SESSION_SECRET: TEST_SESSION_SECRET,
    MAX_BODY_BYTES: "1048576",
    ...overrides,
  } as Env;
  return { env, db, kv };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

export async function seedAdmin(
  env: Env,
  email = "admin@example.com",
  password = "correct-horse-battery-staple",
): Promise<{ email: string; password: string; token: string; userId: string }> {
  const hash = await hashPassword(password);
  const userId = newId("usr");
  await createUser(env.DB, userId, email, hash);
  const token = await createSessionToken(userId, env.SESSION_SECRET);
  return { email, password, token, userId };
}

export async function seedUnifiedKey(env: Env, name = "Test key"): Promise<string> {
  const key = generateUnifiedKey();
  const hash = await sha256Hex(key);
  await insertUnifiedKey(env.DB, {
    id: newId("uk"),
    name,
    key_hash: hash,
    prefix: key.slice(0, 13),
    daily_limit: null,
  });
  return key;
}

export async function seedProviderKey(
  env: Env,
  provider: string,
  key = "sk-test-PLACEHOLDER",
  opts: { priority?: number; baseUrl?: string | null; modelId?: string | null; status?: string } = {},
): Promise<string> {
  const encrypted = await encryptSecret(key, env.ENCRYPTION_KEY);
  const id = newId("pk");
  await insertProviderKey(env.DB, {
    id,
    provider,
    label: null,
    key_encrypted: encrypted.ciphertext,
    key_iv: encrypted.iv,
    key_tag: encrypted.tag,
    key_version: 1,
    key_masked: maskKey(key),
    priority: opts.priority ?? 100,
    enabled: 1,
    status: opts.status ?? "healthy",
    last_tested_at: new Date().toISOString(),
    last_error: null,
    base_url: opts.baseUrl ?? null,
    model_id: opts.modelId ?? null,
  });
  return id;
}

/** Build a Request with a JSON body and optional headers. */
export function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Canned upstream responses (for the stubbed global fetch)
// ---------------------------------------------------------------------------

export function openAiChatResponse(
  content: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } = {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  },
): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [
        { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
      ],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

export function geminiResponse(
  text: string,
  usage: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } = {
    promptTokenCount: 10,
    candidatesTokenCount: 5,
    totalTokenCount: 15,
  },
): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text }], role: "model" }, finishReason: "STOP" },
      ],
      usageMetadata: usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** An SSE stream of OpenAI chat chunks (for streaming tests). */
export function openAiStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const text of chunks) {
        const payload = JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** A DNS-over-HTTPS JSON response resolving a name to the given IPs. */
export function dohResponse(ips: string[]): Response {
  return new Response(
    JSON.stringify({
      Status: 0,
      Answer: ips.map((ip) => ({ name: "example.com.", type: ip.includes(":") ? 28 : 1, TTL: 60, data: ip })),
    }),
    { status: 200, headers: { "content-type": "application/dns-json" } },
  );
}
