// FREE AI API HUB — Google Gemini adapter (bespoke).
// Gemini's wire format differs from OpenAI's (generateContent /
// streamGenerateContent, system_instruction, role "model"), so this adapter
// translates both ways and normalizes to OpenAI-shaped responses.
// Original code for this project.

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatMessage,
} from "@free-ai-api-hub/shared";
import { upstreamError } from "../lib/errors";
import { extractUsage, parseSSE } from "../lib/sse";
import { makeResponse, mapFinishReason, type AdapterRequest, type KeyValidation, type ProviderAdapter } from "./base";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiContent {
  role?: string;
  parts: GeminiPart[];
}

function toGeminiContents(messages: ChatMessage[]): {
  system_instruction?: { parts: { text: string }[] };
  contents: GeminiContent[];
} {
  let system_instruction: { parts: { text: string }[] } | undefined;
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = (system_instruction?.parts[0]?.text ?? "") + m.content;
      system_instruction = { parts: [{ text }] };
      continue;
    }
    if (m.role === "tool") continue; // v1: tool results are not passed to Gemini
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  return { system_instruction, contents };
}

function toGeminiTools(tools: unknown[] | undefined): unknown {
  if (!tools || tools.length === 0) return undefined;
  const declarations = tools
    .filter((t): t is { function?: { name?: string; description?: string; parameters?: unknown } } =>
      typeof t === "object" && t !== null && "function" in (t as Record<string, unknown>),
    )
    .map((t) => ({
      name: t.function?.name ?? "",
      description: t.function?.description ?? "",
      parameters: t.function?.parameters ?? { type: "OBJECT", properties: {} },
    }))
    .filter((d) => d.name !== "");
  if (declarations.length === 0) return undefined;
  return [{ functionDeclarations: declarations }];
}

function generationConfig(req: AdapterRequest): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  if (req.temperature !== undefined) cfg.temperature = req.temperature;
  if (req.max_tokens !== undefined) cfg.maxOutputTokens = req.max_tokens;
  if (req.top_p !== undefined) cfg.topP = req.top_p;
  if (req.stop !== undefined) {
    cfg.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }
  return cfg;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; status?: string; code?: number };
}

function candidateToText(candidate: GeminiCandidate | undefined): string {
  if (!candidate?.content?.parts) return "";
  return candidate.content.parts
    .map((p) => p.text ?? "")
    .join("");
}

function toOpenAIResponse(model: string, data: GeminiResponse): ChatCompletionResponse {
  const candidate = data.candidates?.[0];
  const usage = data.usageMetadata ?? {};
  return makeResponse(
    model,
    candidateToText(candidate),
    mapFinishReason(candidate?.finishReason),
    {
      prompt_tokens: usage.promptTokenCount ?? 0,
      completion_tokens: usage.candidatesTokenCount ?? 0,
      total_tokens:
        usage.totalTokenCount ??
        (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
    },
  );
}

async function readGeminiError(res: Response): Promise<{ status: number; message: string }> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (json.error?.message) return { status: res.status, message: json.error.message };
  } catch {
    // fall through
  }
  return { status: res.status, message: text || `Gemini returned HTTP ${res.status}` };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly id = "gemini";

  private headers(apiKey: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    };
  }

  private body(req: AdapterRequest): Record<string, unknown> {
    const { system_instruction, contents } = toGeminiContents(req.messages);
    const body: Record<string, unknown> = { contents, generationConfig: generationConfig(req) };
    if (system_instruction) body.system_instruction = system_instruction;
    const tools = toGeminiTools(req.tools);
    if (tools) body.tools = tools;
    return body;
  }

  async chat(
    apiKey: string,
    req: AdapterRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const res = await fetch(
      `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:generateContent`,
      {
        method: "POST",
        headers: this.headers(apiKey),
        body: JSON.stringify(this.body(req)),
        signal,
      },
    );
    if (!res.ok) {
      const { status, message } = await readGeminiError(res);
      // Gemini reports a bad API key as HTTP 400 ("API key not valid").
      // Normalize that to 401 so the router treats it as an auth failure
      // (bench the key, fall back to the next candidate) instead of a
      // non-retryable client error that stops the chain.
      const authFailure = status === 400 && /api[ _-]?key|invalid key/i.test(message);
      throw upstreamError(authFailure ? 401 : status, message, {
        retryable: status === 429 || status >= 500,
      });
    }
    const data = (await res.json()) as GeminiResponse;
    if (data.error) {
      throw upstreamError(data.error.code ?? 500, data.error.message ?? "Gemini error");
    }
    return toOpenAIResponse(req.model, data);
  }

  async *stream(
    apiKey: string,
    req: AdapterRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const res = await fetch(
      `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: this.headers(apiKey),
        body: JSON.stringify(this.body(req)),
        signal,
      },
    );
    if (!res.ok) {
      const { status, message } = await readGeminiError(res);
      const authFailure = status === 400 && /api[ _-]?key|invalid key/i.test(message);
      throw upstreamError(authFailure ? 401 : status, message, {
        retryable: status === 429 || status >= 500,
      });
    }
    if (!res.body) {
      throw upstreamError(502, "Gemini returned an empty stream", { retryable: true });
    }
    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    let accumulated = "";
    for await (const payload of parseSSE(res.body)) {
      const data = payload as unknown as GeminiResponse;
      if (data.error) {
        throw upstreamError(data.error.code ?? 500, data.error.message ?? "Gemini error");
      }
      const candidate = data.candidates?.[0];
      const text = candidateToText(candidate);
      const delta = text.slice(accumulated.length);
      accumulated = text;
      const usage = extractUsage(payload);
      yield {
        id,
        object: "chat.completion.chunk",
        created,
        model: req.model,
        choices: [
          {
            index: 0,
            delta: delta ? { role: "assistant", content: delta } : {},
            finish_reason: candidate?.finishReason
              ? mapFinishReason(candidate.finishReason)
              : null,
          },
        ],
        ...(usage ? { usage } : {}),
      };
    }
  }

  async validateKey(apiKey: string, model = "gemini-2.5-flash"): Promise<KeyValidation> {
    try {
      const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: this.headers(apiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return { valid: true };
      if (res.status === 429) return { valid: true };
      const { message } = await readGeminiError(res);
      return { valid: false, error: message };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Validation request failed",
      };
    }
  }
}
