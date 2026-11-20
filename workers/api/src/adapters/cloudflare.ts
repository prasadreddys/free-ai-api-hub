// FREE AI API HUB — Cloudflare Workers AI adapter (binding, no API key).
// Calls env.AI.run() directly; no key is stored for this provider.
// Token counts are not reported by Workers AI, so usage is recorded as
// zero tokens (honest — never fabricated) and the dashboard labels it.
// Original code for this project.

import type { Ai } from "@cloudflare/workers-types";
import type { ChatCompletionChunk, ChatCompletionResponse } from "@free-ai-api-hub/shared";
import { upstreamError } from "../lib/errors";
import { parseSSE } from "../lib/sse";
import { makeResponse, type AdapterRequest, type KeyValidation, type ProviderAdapter } from "./base";

export class CloudflareAdapter implements ProviderAdapter {
  readonly id = "cloudflare";
  private readonly ai: Ai;

  constructor(ai: Ai) {
    this.ai = ai;
  }

  private toAiMessages(req: AdapterRequest): { role: string; content: string }[] {
    return req.messages
      .filter((m) => m.role === "system" || m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async chat(
    _apiKey: string,
    req: AdapterRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    let out: unknown;
    try {
      out = await this.ai.run(
        req.model as never,
        {
          messages: this.toAiMessages(req),
          max_tokens: req.max_tokens,
          temperature: req.temperature,
        } as never,
        // Workers AI run() does not take an AbortSignal in the binding;
        // the caller enforces the timeout around the whole attempt.
        // `signal` is accepted for interface symmetry.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      );
      void signal;
    } catch (err) {
      throw upstreamError(
        502,
        err instanceof Error ? err.message : "Workers AI call failed",
        { retryable: true },
      );
    }
    const text =
      typeof out === "string"
        ? out
        : (out as { response?: string })?.response ??
          (out as { result?: { response?: string } })?.result?.response ??
          "";
    // Workers AI does not report token counts for chat models.
    return makeResponse(req.model, text, "stop", {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  }

  async *stream(
    _apiKey: string,
    req: AdapterRequest,
    _signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const out = (await this.ai.run(
      req.model as never,
      {
        messages: this.toAiMessages(req),
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        stream: true,
      } as never,
    )) as unknown as ReadableStream<Uint8Array> | { response?: string };
    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    if (out && typeof out === "object" && "getReader" in (out as Record<string, unknown>)) {
      const stream = out as ReadableStream<Uint8Array>;
      for await (const payload of parseSSE(stream)) {
        const text = (payload.response as string) ?? "";
        if (!text) continue;
        yield {
          id,
          object: "chat.completion.chunk",
          created,
          model: req.model,
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        };
      }
      yield {
        id,
        object: "chat.completion.chunk",
        created,
        model: req.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      return;
    }
    // Non-streaming fallback: single chunk with the whole response.
    const text = (out as { response?: string })?.response ?? "";
    yield {
      id,
      object: "chat.completion.chunk",
      created,
      model: req.model,
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }],
    };
  }

  /** Workers AI needs no key — the binding is the credential. Always valid. */
  async validateKey(_apiKey: string): Promise<KeyValidation> {
    return { valid: true };
  }
}
