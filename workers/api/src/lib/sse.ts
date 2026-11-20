// FREE AI API HUB — SSE helpers.
// Adapters normalize upstream streams to OpenAI-shaped chunks; the router
// re-serializes them as SSE. This module parses an upstream SSE byte stream
// into chunks and serializes chunks back out. Original code.

import type { ChatCompletionChunk, ChatUsage } from "@free-ai-api-hub/shared";

/**
 * Parse a ReadableStream of SSE bytes into an async generator of parsed
 * `data:` payloads. `[DONE]` ends the stream. Malformed lines are skipped
 * (the upstream is untrusted input; a bad frame must not kill the stream).
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return;
          if (payload === "") continue;
          try {
            yield JSON.parse(payload) as Record<string, unknown>;
          } catch {
            // Skip a malformed frame; the stream continues.
          }
        }
      }
    }
    // Flush any trailing partial frame.
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== "[DONE]") {
        try {
          yield JSON.parse(payload) as Record<string, unknown>;
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Serialize OpenAI chunks into an SSE Response body. */
export function sseResponse(chunks: AsyncIterable<ChatCompletionChunk>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/**
 * Extract a `usage` object from a parsed SSE payload, when present
 * (OpenAI sends it in the final chunk when stream_options.include_usage
 * is set; Gemini sends `usageMetadata`).
 */
export function extractUsage(payload: Record<string, unknown>): ChatUsage | null {
  const usage = payload.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  if (usage && typeof usage.prompt_tokens === "number") {
    return {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens:
        usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    };
  }
  const meta = payload.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  if (meta && typeof meta.promptTokenCount === "number") {
    return {
      prompt_tokens: meta.promptTokenCount ?? 0,
      completion_tokens: meta.candidatesTokenCount ?? 0,
      total_tokens:
        meta.totalTokenCount ??
        (meta.promptTokenCount ?? 0) + (meta.candidatesTokenCount ?? 0),
    };
  }
  return null;
}
