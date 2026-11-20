// FREE AI API HUB — provider adapter interface.
// Every adapter normalizes its upstream to OpenAI-shaped responses/chunks,
// so the router and the frontend only ever speak one shape.
// Original code for this project.

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatMessage,
} from "@free-ai-api-hub/shared";

export interface AdapterRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: { type: string };
  stop?: string | string[];
}

export interface KeyValidation {
  valid: boolean;
  /** Human-readable reason when invalid (upstream error, sanitized). */
  error?: string;
}

export interface ProviderAdapter {
  readonly id: string;
  /** Non-streaming chat completion. Throws ApiError on upstream failure. */
  chat(apiKey: string, req: AdapterRequest, signal: AbortSignal): Promise<ChatCompletionResponse>;
  /** Streaming chat completion as OpenAI-shaped chunks. */
  stream(
    apiKey: string,
    req: AdapterRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk>;
  /**
   * Validate a key with a tiny probe completion (max_tokens=1) against a
   * real model id when one is known. A 429 means the key authenticated but
   * is rate-limited — that counts as valid (the key works; the quota is
   * the problem, not the key). Never trust a public /v1/models endpoint
   * as proof of a valid key.
   */
  validateKey(apiKey: string, model?: string): Promise<KeyValidation>;
}

/** Build a minimal OpenAI-shaped response (used by adapters that must synthesize one). */
export function makeResponse(
  model: string,
  text: string,
  finishReason: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): ChatCompletionResponse {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: finishReason,
      },
    ],
    usage,
  };
}

/** Map an upstream finish reason onto the OpenAI vocabulary. */
export function mapFinishReason(reason: string | null | undefined): string {
  if (!reason) return "stop";
  const r = reason.toLowerCase();
  if (r === "stop" || r === "end_turn" || r === "stop_sequence") return "stop";
  if (r === "length" || r === "max_tokens") return "length";
  if (r === "tool_calls" || r === "tool_call") return "tool_calls";
  if (r === "content_filter" || r === "safety" || r === "blocked") return "content_filter";
  return "stop";
}
