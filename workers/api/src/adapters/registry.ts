// FREE AI API HUB — provider registry.
// Built-in providers use hardcoded base URLs (trusted constants).
// Custom providers use the base_url stored on their provider_keys row.
// Cohere / Z.ai / NVIDIA are HELD in v1 (terms-of-use flags) and are
// refused here, so they can never be registered by mistake.
// Original code for this project.

import type { Ai } from "@cloudflare/workers-types";
import { ApiError } from "../lib/errors";
import type { ProviderAdapter } from "./base";
import { CloudflareAdapter } from "./cloudflare";
import { GeminiAdapter } from "./gemini";
import { OpenAICompatAdapter } from "./openai-compat";

export interface ProviderDef {
  id: string;
  name: string;
  /** Hardcoded base URL, or null when the provider has no HTTP endpoint. */
  baseUrl: string | null;
  kind: "openai-compat" | "gemini" | "cloudflare";
  /** True when no API key is needed (Workers AI binding). */
  keyless?: boolean;
}

export const PROVIDERS: Record<string, ProviderDef> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    kind: "gemini",
  },
  groq: {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    kind: "openai-compat",
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    kind: "openai-compat",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    kind: "openai-compat",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    kind: "openai-compat",
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    kind: "openai-compat",
  },
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    baseUrl: null,
    kind: "cloudflare",
    keyless: true,
  },
  custom: {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    baseUrl: null,
    kind: "openai-compat",
  },
};

/** Providers held back in v1 for terms-of-use review. Never register them. */
export const HELD_PROVIDER_IDS = new Set(["cohere", "zai", "nvidia"]);

export function isHeldProvider(providerId: string): boolean {
  return HELD_PROVIDER_IDS.has(providerId.toLowerCase());
}

export function getProviderDef(providerId: string): ProviderDef | null {
  return PROVIDERS[providerId.toLowerCase()] ?? null;
}

/**
 * Build the adapter for a provider.
 * - `baseUrlOverride` is used for custom providers (from the stored key row).
 * - `ai` is required for the Cloudflare provider.
 * Throws 400 for unknown or held providers.
 */
export function getAdapter(
  providerId: string,
  opts: { baseUrlOverride?: string | null; ai?: Ai } = {},
): ProviderAdapter {
  const id = providerId.toLowerCase();
  if (isHeldProvider(id)) {
    throw new ApiError(
      400,
      "invalid_request_error",
      `Provider "${id}" is held in v1 for terms-of-use review and cannot be used yet`,
    );
  }
  const def = getProviderDef(id);
  if (!def) {
    throw new ApiError(400, "invalid_request_error", `Unknown provider: ${providerId}`);
  }
  switch (def.kind) {
    case "gemini":
      return new GeminiAdapter();
    case "cloudflare": {
      if (!opts.ai) {
        throw new ApiError(
          500,
          "server_error",
          "Workers AI binding is not configured for this deployment",
        );
      }
      return new CloudflareAdapter(opts.ai);
    }
    case "openai-compat": {
      const baseUrl = opts.baseUrlOverride ?? def.baseUrl;
      if (!baseUrl) {
        throw new ApiError(
          400,
          "invalid_request_error",
          `Provider "${id}" needs a base URL (custom providers must store one)`,
        );
      }
      const extraHeaders: Record<string, string> =
        id === "openrouter"
          ? { "HTTP-Referer": "https://free-ai-api-hub.pages.dev", "X-Title": "FREE AI API HUB" }
          : {};
      return new OpenAICompatAdapter(id, baseUrl, extraHeaders);
    }
  }
}
