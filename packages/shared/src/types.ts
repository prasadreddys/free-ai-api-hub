// FREE AI API HUB — shared types (worker + web).
// Original types for this project. No code, UI, or naming copied from any
// reference implementation.

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Providers with a v1 adapter. Cohere / Z.ai / NVIDIA are HELD (terms). */
export type ProviderId =
  | "gemini"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "mistral"
  | "huggingface"
  | "cloudflare"
  | "custom";

/** Providers held back in v1 for terms-of-use review. Never list as usable. */
export const HELD_PROVIDERS = ["cohere", "zai", "nvidia"] as const;

export type ProviderStatus =
  | "operational"
  | "degraded"
  | "not_configured"
  | "not_verified";

export interface ProviderInfo {
  id: string;
  name: string;
  status: ProviderStatus;
  last_check_at: string | null;
  last_error: string | null;
  /** Quota as last observed, with the date it was observed. Never a promise. */
  quota_remaining: number | null;
  quota_reset_at: string | null;
}

// ---------------------------------------------------------------------------
// Chat completions (OpenAI-compatible, v1 subset)
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: { type: string };
  stop?: string | string[];
  user?: string;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: ChatUsage;
}

export interface ChatChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatChunkChoice[];
  usage?: ChatUsage;
}

// ---------------------------------------------------------------------------
// Models catalog
// ---------------------------------------------------------------------------

export type ModelCapability =
  | "chat"
  | "coding"
  | "reasoning"
  | "vision"
  | "tools"
  | "structured_outputs";

export interface ModelInfo {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  capabilities: ModelCapability[];
  context_window: number | null;
  supports_streaming: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  free_tier: boolean;
  /** True only after a live test passed. False = manually configured. */
  verified: boolean;
  last_verified_at: string | null;
  available: boolean;
  last_error: string | null;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export interface ProviderKeyInfo {
  id: string;
  provider: string;
  label: string | null;
  key_masked: string;
  priority: number;
  enabled: boolean;
  status: "healthy" | "auth_failed" | "cooldown" | "not_verified" | "error";
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface UnifiedKeyInfo {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  daily_limit: number | null;
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type RouterStrategy =
  | "best_available"
  | "fastest"
  | "round_robin"
  | "manual_priority";

export interface RoutingProfile {
  id: string;
  name: string;
  strategy: RouterStrategy;
  retry_limit: number;
  timeout_ms: number;
  cooldown_ms: number;
  is_default: boolean;
  models: string[]; // model ids in chain order
}

// ---------------------------------------------------------------------------
// Usage / analytics
// ---------------------------------------------------------------------------

export interface UsageSummary {
  window: "24h" | "7d" | "30d";
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  avg_latency_ms: number;
  fallback_events: number;
  by_provider: Record<string, { requests: number; tokens: number; errors: number }>;
  by_model: Record<string, { requests: number; tokens: number; errors: number }>;
}

export interface HourlyPoint {
  hour: string;
  requests: number;
  errors: number;
  tokens_in: number;
  tokens_out: number;
  latency_p50: number | null;
  latency_p95: number | null;
}

// ---------------------------------------------------------------------------
// API errors (OpenAI-shaped)
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    message: string;
    type: string;
    code?: string;
    /** Every failed attempt, in order, when a fallback chain exhausted. */
    attempts?: { provider: string; model: string; error: string }[];
  };
}
