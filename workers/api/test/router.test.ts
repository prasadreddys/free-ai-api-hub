// FREE AI API HUB — router + chat endpoint tests.
// Upstreams are mocked; the D1 is real (node:sqlite) and the KV is real.
// A plain model request only tries that model's providers; the fallback
// chain across models runs for `auto` requests (the profile's model list).

import { describe, expect, it, vi, afterEach } from "vitest";
import { handleChatCompletion } from "../src/routes/chat";
import { executeChat, executeChatStream } from "../src/router";
import { ApiError } from "../src/lib/errors";
import {
  geminiResponse,
  jsonRequest,
  makeEnv,
  openAiChatResponse,
  openAiStreamResponse,
  seedProviderKey,
  seedUnifiedKey,
} from "./setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function autoRequest(unifiedKey: string) {
  return jsonRequest("https://gateway.test/v1/chat/completions", {
    model: "auto",
    messages: [{ role: "user", content: "Hello" }],
    stream: false,
  }, { authorization: `Bearer ${unifiedKey}` });
}

describe("chat endpoint — happy path", () => {
  it("routes a Groq model to Groq and returns the content + X-Routed-Via", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === GROQ_URL) return openAiChatResponse("Hello from Groq");
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const req = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    }, { authorization: `Bearer ${unifiedKey}` });
    const res = await handleChatCompletion(env, req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-routed-via")).toBe("groq/llama-3.3-70b-versatile");
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0].message.content).toBe("Hello from Groq");
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_logs").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("rejects a request with no unified key (401)", async () => {
    const { env } = makeEnv();
    const req = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hello" }],
    });
    const res = await handleChatCompletion(env, req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/unified api key/i);
  });

  it("rejects an unknown model (400)", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    const req = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "not-a-real-model",
      messages: [{ role: "user", content: "Hello" }],
    }, { authorization: `Bearer ${unifiedKey}` });
    const res = await handleChatCompletion(env, req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/unknown model/i);
  });

  it("returns 503 when no provider keys are configured", async () => {
    const { env } = makeEnv();
    const unifiedKey = await seedUnifiedKey(env);
    const req = jsonRequest("https://gateway.test/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Hello" }],
    }, { authorization: `Bearer ${unifiedKey}` });
    const res = await handleChatCompletion(env, req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/no healthy key/i);
  });
});

describe("router — fallback via the auto profile", () => {
  it("falls back to Groq when Gemini 500s, and reports the fallback", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "gemini", "gemini-test-PLACEHOLDER");
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return new Response("boom", { status: 500 });
        }
        if (url === GROQ_URL) return openAiChatResponse("Hello from Groq");
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const res = await handleChatCompletion(env, autoRequest(unifiedKey));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-routed-via")).toBe("groq/llama-3.3-70b-versatile");
    expect(res.headers.get("x-fallback-count")).toBe("1");
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0].message.content).toBe("Hello from Groq");
  });

  it("returns 502 when every candidate fails", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "gemini", "gemini-test-PLACEHOLDER");
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const res = await handleChatCompletion(env, autoRequest(unifiedKey));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string; attempts?: unknown[] } };
    expect(body.error.message).toMatch(/all fallback candidates failed/i);
    expect(body.error.attempts).toHaveLength(2);
  });

  it("cools a rate-limited key down and skips it on the next request", async () => {
    const { env, kv } = makeEnv();
    await seedProviderKey(env, "gemini", "gemini-test-PLACEHOLDER");
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    let geminiCalls = 0;
    let groqCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          geminiCalls++;
          return new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
            status: 429,
            headers: { "retry-after": "0", "content-type": "application/json" },
          });
        }
        if (url === GROQ_URL) {
          groqCalls++;
          return openAiChatResponse("Hello from Groq");
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    // Request 1: Gemini 429s, falls back to Groq.
    const res1 = await handleChatCompletion(env, autoRequest(unifiedKey));
    expect(res1.status).toBe(200);
    expect(res1.headers.get("x-routed-via")).toBe("groq/llama-3.3-70b-versatile");
    expect(geminiCalls).toBe(1);
    expect(groqCalls).toBe(1);

    // The Gemini key now has a KV cooldown.
    const listed = await kv.list({ prefix: "cooldown:gemini:" });
    expect(listed.keys.length).toBe(1);

    // Request 2: Gemini is skipped entirely (no new Gemini calls).
    const res2 = await handleChatCompletion(env, autoRequest(unifiedKey));
    expect(res2.status).toBe(200);
    expect(res2.headers.get("x-routed-via")).toBe("groq/llama-3.3-70b-versatile");
    expect(geminiCalls).toBe(1);
    expect(groqCalls).toBe(2);
  });

  it("never makes more than 5 router attempts per request", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "gemini", "gemini-test-PLACEHOLDER");
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    await seedProviderKey(env, "cerebras", "csk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("boom", { status: 500 });
      }),
    );
    const res = await handleChatCompletion(env, autoRequest(unifiedKey));
    expect(res.status).toBe(502);
    // 3 candidates (gemini, groq, cerebras), one attempt each, capped at 5.
    expect(calls).toBe(3);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_logs WHERE status = 'error'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("marks an auth-failed key so it is never tried again", async () => {
    const { env } = makeEnv();
    const geminiKeyId = await seedProviderKey(env, "gemini", "bad-gemini-key");
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    const unifiedKey = await seedUnifiedKey(env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return new Response(JSON.stringify({ error: { message: "API key not valid" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === GROQ_URL) return openAiChatResponse("Hello from Groq");
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const res = await handleChatCompletion(env, autoRequest(unifiedKey));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-routed-via")).toBe("groq/llama-3.3-70b-versatile");
    const keyRow = await env.DB.prepare("SELECT status FROM provider_keys WHERE id = ?")
      .bind(geminiKeyId)
      .first<{ status: string }>();
    expect(keyRow?.status).toBe("auth_failed");
  });
});

describe("router — streaming", () => {
  it("streams OpenAI chunks and reports the routed provider", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === GROQ_URL) return openAiStreamResponse(["Hello ", "stream"]);
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const outcome = await executeChatStream(
      env,
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Hello" }],
      },
      { unifiedKeyId: null },
    );
    expect(outcome.routedVia).toBe("groq/llama-3.3-70b-versatile");
    let text = "";
    for await (const chunk of outcome.chunks) {
      text += chunk.choices[0]?.delta?.content ?? "";
    }
    expect(text).toBe("Hello stream");
    const done = await outcome.done;
    expect(done.usage.total_tokens).toBe(0); // mock stream carries no usage
    // The stream was logged as a successful usage row.
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_logs WHERE status = 'success'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("executeChat throws a 502 ApiError when all providers fail", async () => {
    const { env } = makeEnv();
    await seedProviderKey(env, "groq", "gsk-test-PLACEHOLDER");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(
      executeChat(env, {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Hello" }],
      }, { unifiedKeyId: null }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
