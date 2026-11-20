// FREE AI API HUB — provider adapter tests.
// The global fetch is stubbed; no real network.
// Adapters throw ApiError (via upstreamError), not a custom error class,
// and they do NOT retry internally — the router does the fallback.

import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenAICompatAdapter } from "../src/adapters/openai-compat";
import { GeminiAdapter } from "../src/adapters/gemini";
import { CloudflareAdapter } from "../src/adapters/cloudflare";
import { getAdapter, getProviderDef } from "../src/adapters/registry";
import { ApiError } from "../src/lib/errors";
import { geminiResponse, makeFakeAi, openAiChatResponse } from "./setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => handler(url, init)),
  );
}

const SIGNAL = AbortSignal.timeout(10000);

const chatReq = {
  model: "llama-3.3-70b-versatile",
  messages: [{ role: "user" as const, content: "Hello" }],
};

describe("OpenAICompatAdapter", () => {
  it("returns content and real token counts on success", async () => {
    stubFetch(() => openAiChatResponse("Hello there", { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 }));
    const adapter = new OpenAICompatAdapter("groq", "https://api.groq.com/openai/v1");
    const res = await adapter.chat("sk-test-PLACEHOLDER", chatReq, SIGNAL);
    expect(res.choices[0].message.content).toBe("Hello there");
    expect(res.usage.prompt_tokens).toBe(12);
    expect(res.usage.completion_tokens).toBe(7);
    expect(res.model).toBe("test-model");
  });

  it("maps a 401 to an authentication ApiError (not retryable)", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new OpenAICompatAdapter("groq", "https://api.groq.com/openai/v1");
    let caught: unknown;
    try {
      await adapter.chat("bad-key", chatReq, SIGNAL);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 401, type: "authentication_error", retryable: false });
    expect(calls).toBe(1); // auth errors are not retried
  });

  it("throws a retryable ApiError on 429 (the router retries, not the adapter)", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
        status: 429,
        headers: { "retry-after": "0", "content-type": "application/json" },
      });
    });
    const adapter = new OpenAICompatAdapter("groq", "https://api.groq.com/openai/v1");
    let caught: unknown;
    try {
      await adapter.chat("sk-test-PLACEHOLDER", chatReq, SIGNAL);
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 429, type: "rate_limit_error", retryable: true });
    expect(calls).toBe(1);
  });

  it("throws a retryable ApiError on a 500", async () => {
    stubFetch(() => new Response("Internal error", { status: 500 }));
    const adapter = new OpenAICompatAdapter("groq", "https://api.groq.com/openai/v1");
    await expect(adapter.chat("sk-test-PLACEHOLDER", chatReq, SIGNAL)).rejects.toMatchObject({
      status: 500,
      retryable: true,
    });
  });

  it("validateKey: a probe completion proves the key", async () => {
    stubFetch(() => openAiChatResponse("ok"));
    const adapter = new OpenAICompatAdapter("groq", "https://api.groq.com/openai/v1");
    const res = await adapter.validateKey("sk-test-PLACEHOLDER", "llama-3.3-70b-versatile");
    expect(res.valid).toBe(true);
  });

  it("validateKey: a 401 proves the key is bad", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const adapter = new OpenAICompatAdapter("groq", "https://api.groq.com/openai/v1");
    const res = await adapter.validateKey("bad-key", "llama-3.3-70b-versatile");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/Incorrect API key/);
  });

  it("validateKey: a 429 counts as valid (authenticated, just rate-limited)", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
          status: 429,
          headers: { "retry-after": "0", "content-type": "application/json" },
        }),
    );
    const adapter = new OpenAICompatAdapter("groq", "https://api.groq.com/openai/v1");
    const res = await adapter.validateKey("sk-test-PLACEHOLDER", "llama-3.3-70b-versatile");
    expect(res.valid).toBe(true);
  });
});

describe("GeminiAdapter", () => {
  it("maps a generateContent response to OpenAI shape", async () => {
    stubFetch((url) => {
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("gemini-2.5-flash:generateContent");
      return geminiResponse("Hi from Gemini", {
        promptTokenCount: 8,
        candidatesTokenCount: 4,
        totalTokenCount: 12,
      });
    });
    const adapter = new GeminiAdapter();
    const res = await adapter.chat(
      "gemini-key-PLACEHOLDER",
      { model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hello" }] },
      SIGNAL,
    );
    expect(res.choices[0].message.content).toBe("Hi from Gemini");
    expect(res.usage.prompt_tokens).toBe(8);
    expect(res.usage.completion_tokens).toBe(4);
    expect(res.usage.total_tokens).toBe(12);
  });

  it("maps a Gemini 400 to an invalid_request ApiError", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "Invalid request: bad model" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    const adapter = new GeminiAdapter();
    await expect(
      adapter.chat(
        "some-key",
        { model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }] },
        SIGNAL,
      ),
    ).rejects.toMatchObject({ status: 400, type: "invalid_request_error" });
  });

  it("normalizes a Gemini 400 bad-key error to 401 (so the router falls back)", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    const adapter = new GeminiAdapter();
    await expect(
      adapter.chat(
        "bad-key",
        { model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }] },
        SIGNAL,
      ),
    ).rejects.toMatchObject({ status: 401, type: "authentication_error" });
  });

  it("validateKey succeeds on a probe completion", async () => {
    stubFetch(() => geminiResponse("ok"));
    const adapter = new GeminiAdapter();
    const res = await adapter.validateKey("gemini-key-PLACEHOLDER");
    expect(res.valid).toBe(true);
  });
});

describe("CloudflareAdapter", () => {
  it("calls the Workers AI binding and reports zero tokens honestly", async () => {
    const ai = makeFakeAi("Workers AI says hi");
    const adapter = new CloudflareAdapter(ai as unknown as Ai);
    const res = await adapter.chat(
      "",
      {
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        messages: [{ role: "user", content: "Hello" }],
      },
      SIGNAL,
    );
    expect(res.choices[0].message.content).toBe("Workers AI says hi");
    expect(res.usage.prompt_tokens).toBe(0);
    expect(res.usage.completion_tokens).toBe(0);
    expect(res.usage.total_tokens).toBe(0);
  });

  it("validateKey always passes (the binding is the credential)", async () => {
    const ai = makeFakeAi();
    const adapter = new CloudflareAdapter(ai as unknown as Ai);
    const res = await adapter.validateKey("");
    expect(res.valid).toBe(true);
  });
});

describe("registry", () => {
  it("refuses held providers (Cohere, Z.ai, NVIDIA)", () => {
    for (const id of ["cohere", "zai", "nvidia"]) {
      expect(() => getAdapter(id, {})).toThrow(/held in v1/i);
    }
  });

  it("refuses unknown providers", () => {
    expect(() => getAdapter("not-a-provider", {})).toThrow(/unknown provider/i);
  });

  it("returns a Gemini adapter for gemini", () => {
    const adapter = getAdapter("gemini", {});
    expect(adapter).toBeInstanceOf(GeminiAdapter);
  });

  it("returns an OpenAI-compatible adapter for groq", () => {
    const adapter = getAdapter("groq", {});
    expect(adapter).toBeInstanceOf(OpenAICompatAdapter);
  });

  it("returns null for an unknown provider definition", () => {
    expect(getProviderDef("nope")).toBeNull();
  });

  it("getProviderDef returns the Gemini definition", () => {
    const def = getProviderDef("gemini");
    expect(def?.name).toBe("Google Gemini");
    expect(def?.kind).toBe("gemini");
    expect(def?.baseUrl).toContain("generativelanguage.googleapis.com");
  });

  it("marks Cloudflare as keyless", () => {
    expect(getProviderDef("cloudflare")?.keyless).toBe(true);
  });
});
