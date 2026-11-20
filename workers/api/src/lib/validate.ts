// FREE AI API HUB — input validation for the public API.
// Small, dependency-free validators. Unknown fields are stripped;
// numeric fields are clamped to sane ranges. Original code.

import { invalidRequest } from "./errors";
import type { ChatCompletionRequest, ChatMessage } from "@free-ai-api-hub/shared";

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 200_000;
const MAX_TOKENS = 131_072;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Validate + normalize a chat completion request body. Throws 400 on bad input. */
export function validateChatRequest(body: unknown): ChatCompletionRequest {
  if (!isRecord(body)) throw invalidRequest("Request body must be a JSON object");
  const model = body.model;
  if (typeof model !== "string" || model.trim() === "") {
    throw invalidRequest("`model` is required and must be a non-empty string");
  }
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw invalidRequest("`messages` must be a non-empty array");
  }
  if (rawMessages.length > MAX_MESSAGES) {
    throw invalidRequest(`\`messages\` must contain at most ${MAX_MESSAGES} entries`);
  }
  const messages: ChatMessage[] = rawMessages.map((m, i) => {
    if (!isRecord(m)) throw invalidRequest(`messages[${i}] must be an object`);
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant" && m.role !== "tool") {
      throw invalidRequest(`messages[${i}].role must be system, user, assistant, or tool`);
    }
    if (typeof m.content !== "string") {
      throw invalidRequest(`messages[${i}].content must be a string`);
    }
    if (m.content.length > MAX_CONTENT_CHARS) {
      throw invalidRequest(`messages[${i}].content exceeds ${MAX_CONTENT_CHARS} characters`);
    }
    const out: ChatMessage = { role: m.role, content: m.content };
    if (typeof m.name === "string") out.name = m.name;
    if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls;
    if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
    return out;
  });
  // At least one user message is required to do anything useful.
  if (!messages.some((m) => m.role === "user")) {
    throw invalidRequest("`messages` must contain at least one user message");
  }
  const req: ChatCompletionRequest = { model: model.trim(), messages };
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== "number" || Number.isNaN(body.temperature)) {
      throw invalidRequest("`temperature` must be a number");
    }
    req.temperature = clamp(body.temperature, 0, 2);
  }
  if (body.max_tokens !== undefined) {
    if (typeof body.max_tokens !== "number" || Number.isNaN(body.max_tokens)) {
      throw invalidRequest("`max_tokens` must be a number");
    }
    req.max_tokens = clamp(Math.floor(body.max_tokens), 1, MAX_TOKENS);
  }
  if (body.top_p !== undefined) {
    if (typeof body.top_p !== "number" || Number.isNaN(body.top_p)) {
      throw invalidRequest("`top_p` must be a number");
    }
    req.top_p = clamp(body.top_p, 0, 1);
  }
  if (body.stream !== undefined) {
    if (typeof body.stream !== "boolean") throw invalidRequest("`stream` must be a boolean");
    req.stream = body.stream;
  }
  if (body.stop !== undefined) {
    if (typeof body.stop === "string" || (Array.isArray(body.stop) && body.stop.every((s) => typeof s === "string"))) {
      req.stop = body.stop;
    } else {
      throw invalidRequest("`stop` must be a string or an array of strings");
    }
  }
  if (Array.isArray(body.tools)) req.tools = body.tools;
  if (body.tool_choice !== undefined) req.tool_choice = body.tool_choice;
  if (isRecord(body.response_format) && typeof body.response_format.type === "string") {
    req.response_format = { type: body.response_format.type };
  }
  if (typeof body.user === "string") req.user = body.user;
  return req;
}

/** Validate the body for adding a provider key. Throws 400 on bad input. */
export function validateProviderKeyInput(body: unknown): {
  provider: string;
  key: string;
  label?: string;
  priority?: number;
  base_url?: string;
  model_id?: string;
} {
  if (!isRecord(body)) throw invalidRequest("Request body must be a JSON object");
  if (typeof body.provider !== "string" || body.provider.trim() === "") {
    throw invalidRequest("`provider` is required");
  }
  const provider = body.provider.trim().toLowerCase();
  if (provider === "cohere" || provider === "zai" || provider === "nvidia") {
    throw invalidRequest(
      `Provider "${provider}" is held in v1 for terms-of-use review and cannot be added yet`,
    );
  }
  if (typeof body.key !== "string" || body.key.trim() === "") {
    throw invalidRequest("`key` is required");
  }
  const out: { provider: string; key: string; label?: string; priority?: number; base_url?: string; model_id?: string } = {
    provider,
    key: body.key.trim(),
  };
  if (typeof body.label === "string" && body.label.trim() !== "") out.label = body.label.trim();
  if (typeof body.priority === "number" && Number.isFinite(body.priority)) {
    out.priority = clamp(Math.floor(body.priority), 0, 1000);
  }
  if (provider === "custom") {
    if (typeof body.base_url !== "string" || body.base_url.trim() === "") {
      throw invalidRequest("`base_url` is required for a custom provider");
    }
    out.base_url = body.base_url.trim();
    if (typeof body.model_id === "string" && body.model_id.trim() !== "") {
      out.model_id = body.model_id.trim();
    }
  }
  return out;
}

/** Validate a settings body. Returns only the keys that were supplied. */
export function validateSettingsInput(body: unknown): Record<string, string> {
  if (!isRecord(body)) throw invalidRequest("Request body must be a JSON object");
  const out: Record<string, string> = {};
  if (body.store_prompts !== undefined) {
    const v = body.store_prompts;
    if (typeof v === "boolean") out.store_prompts = v ? "1" : "0";
    else if (v === "1" || v === "0") out.store_prompts = v;
    else throw invalidRequest("`store_prompts` must be a boolean (or \"0\"/\"1\")");
  }
  const numeric = (field: string, min: number, max: number): string | null => {
    const raw = (body as Record<string, unknown>)[field];
    if (raw === undefined) return null;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n)) throw invalidRequest(`\`${field}\` must be a number`);
    return String(clamp(Math.floor(n), min, max));
  };
  const retention = numeric("log_retention_days", 1, 365);
  if (retention !== null) out.log_retention_days = retention;
  const rpm = numeric("rate_limit_rpm", 1, 1000);
  if (rpm !== null) out.rate_limit_rpm = rpm;
  return out;
}

/** Validate a routing-profile body. Throws 400 on bad input. */
export function validateProfileInput(body: unknown): {
  name: string;
  strategy: string;
  retry_limit: number;
  timeout_ms: number;
  cooldown_ms: number;
  models: string[];
} {
  if (!isRecord(body)) throw invalidRequest("Request body must be a JSON object");
  if (typeof body.name !== "string" || body.name.trim() === "") {
    throw invalidRequest("`name` is required");
  }
  const strategy = typeof body.strategy === "string" ? body.strategy : "best_available";
  if (!["best_available", "fastest", "round_robin", "manual_priority"].includes(strategy)) {
    throw invalidRequest(`Unknown strategy: ${strategy}`);
  }
  const retry_limit =
    typeof body.retry_limit === "number" ? clamp(Math.floor(body.retry_limit), 1, 5) : 5;
  const timeout_ms =
    typeof body.timeout_ms === "number" ? clamp(Math.floor(body.timeout_ms), 1000, 120000) : 30000;
  const cooldown_ms =
    typeof body.cooldown_ms === "number" ? clamp(Math.floor(body.cooldown_ms), 0, 86400000) : 60000;
  if (!Array.isArray(body.models) || body.models.length === 0) {
    throw invalidRequest("`models` must be a non-empty array of model ids");
  }
  if (!body.models.every((m) => typeof m === "string" && m.trim() !== "")) {
    throw invalidRequest("`models` must contain only non-empty strings");
  }
  return {
    name: body.name.trim(),
    strategy,
    retry_limit,
    timeout_ms,
    cooldown_ms,
    models: body.models as string[],
  };
}
