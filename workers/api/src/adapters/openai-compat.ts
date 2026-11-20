// FREE AI API HUB — generic OpenAI-compatible adapter.
// Covers Groq, Cerebras, OpenRouter, Mistral, Hugging Face, and every
// custom OpenAI-compatible endpoint, by base URL alone.
// Original code for this project.

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "@free-ai-api-hub/shared";
import { ApiError, upstreamError } from "../lib/errors";
import { extractUsage, parseSSE } from "../lib/sse";
import { makeResponse, type AdapterRequest, type KeyValidation, type ProviderAdapter } from "./base";

const PROBE_MESSAGE = "ping";

async function readUpstreamError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `Upstream returned HTTP ${res.status}`;
  try {
    const json = JSON.parse(text) as { error?: { message?: string; type?: string } };
    if (json.error?.message) return json.error.message;
  } catch {
    // Not JSON — use the raw text, truncated.
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function toApiError(status: number, message: string): ApiError {
  return upstreamError(status, message, { retryable: status === 429 || status >= 500 });
}

export function openAiCompatBody(req: AdapterRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
  if (req.top_p !== undefined) body.top_p = req.top_p;
  if (req.stop !== undefined) body.stop = req.stop;
  if (req.tools !== undefined) body.tools = req.tools;
  if (req.tool_choice !== undefined) body.tool_choice = req.tool_choice;
  if (req.response_format !== undefined) body.response_format = req.response_format;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

export class OpenAICompatAdapter implements ProviderAdapter {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(id: string, baseUrl: string, extraHeaders: Record<string, string> = {}) {
    this.id = id;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.extraHeaders = extraHeaders;
  }

  private headers(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.extraHeaders,
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return headers;
  }

  async chat(
    apiKey: string,
    req: AdapterRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(openAiCompatBody(req, false)),
      signal,
    });
    if (!res.ok) {
      throw toApiError(res.status, await readUpstreamError(res));
    }
    const json = (await res.json()) as ChatCompletionResponse;
    // Normalize: guarantee the fields the router relies on.
    json.model = json.model || req.model;
    json.usage = json.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return json;
  }

  async *stream(
    apiKey: string,
    req: AdapterRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(openAiCompatBody(req, true)),
      signal,
    });
    if (!res.ok) {
      throw toApiError(res.status, await readUpstreamError(res));
    }
    if (!res.body) {
      throw upstreamError(502, "Upstream returned an empty stream", { retryable: true });
    }
    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    for await (const payload of parseSSE(res.body)) {
      const choices = payload.choices as
        | { index?: number; delta?: Record<string, unknown>; finish_reason?: string | null }[]
        | undefined;
      if (!choices || choices.length === 0) continue;
      const usage = extractUsage(payload);
      yield {
        id: (payload.id as string) || id,
        object: "chat.completion.chunk",
        created: (payload.created as number) || created,
        model: (payload.model as string) || req.model,
        choices: choices.map((c) => ({
          index: c.index ?? 0,
          delta: (c.delta ?? {}) as ChatCompletionChunk["choices"][number]["delta"],
          finish_reason: c.finish_reason ?? null,
        })),
        ...(usage ? { usage } : {}),
      };
    }
  }

  async validateKey(apiKey: string, model?: string): Promise<KeyValidation> {
    // A probe completion against a real model is the only positive proof.
    // Without a model, fall back to a GET /models check: a 401/403 proves
    // the key is bad, but a 200 does NOT prove it is good (some providers
    // answer 200 unauthenticated). Callers should always pass a model.
    if (!model) {
      try {
        const res = await fetch(`${this.baseUrl}/models`, {
          headers: this.headers(apiKey),
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 401 || res.status === 403) {
          return { valid: false, error: `Upstream rejected the key (HTTP ${res.status})` };
        }
        return { valid: true };
      } catch (err) {
        return {
          valid: false,
          error: err instanceof Error ? err.message : "Validation request failed",
        };
      }
    }
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: PROBE_MESSAGE }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return { valid: true };
      if (res.status === 429) {
        // Authenticated but rate-limited: the key works.
        return { valid: true };
      }
      const msg = await readUpstreamError(res);
      return { valid: false, error: msg };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Validation request failed",
      };
    }
  }
}

/** Build a probe body that uses a real model id (for validateKey with a known model). */
export function probeBody(model: string): Record<string, unknown> {
  return {
    model,
    messages: [{ role: "user", content: PROBE_MESSAGE }],
    max_tokens: 1,
    stream: false,
  };
}
