-- FREE AI API HUB — D1 migration 0002: seed model catalog (MANUALLY CONFIGURED)
-- Every row below is verified = 0. Context windows, capabilities, and
-- free-tier flags come from public provider documentation as of Nov 2026
-- and are NOT live-verified. A model is listed as operational only after
-- a real key validation + probe completion passes; until then the API and
-- the dashboard show it as "not verified". Never treat these rows as
-- promises of availability, quota, or capability.

INSERT OR IGNORE INTO models
  (id, provider, model_id, display_name, capabilities, context_window,
   supports_streaming, supports_tools, supports_vision, free_tier, verified, enabled)
VALUES
  -- Google Gemini (bespoke adapter; generativelanguage.googleapis.com/v1beta)
  ('model-gemini-flash', 'gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash',
   '["chat","coding","reasoning","vision","tools","structured_outputs"]', 1048576, 1, 1, 1, 1, 0, 1),
  ('model-gemini-flash-lite', 'gemini', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite',
   '["chat","coding","vision","tools"]', 1048576, 1, 1, 1, 1, 0, 1),
  -- Groq (OpenAI-compatible)
  ('model-groq-llama-70b', 'groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B Versatile',
   '["chat","coding","reasoning","tools"]', 131072, 1, 1, 0, 1, 0, 1),
  ('model-groq-llama-8b', 'groq', 'llama-3.1-8b-instant', 'Llama 3.1 8B Instant',
   '["chat","coding","tools"]', 131072, 1, 1, 0, 1, 0, 1),
  ('model-groq-qwq', 'groq', 'qwen-qwq-32b', 'Qwen QwQ 32B (reasoning)',
   '["chat","reasoning"]', 128000, 1, 0, 0, 1, 0, 1),
  ('model-groq-r1', 'groq', 'deepseek-r1-distill-llama-70b', 'DeepSeek R1 Distill Llama 70B',
   '["chat","reasoning","coding"]', 131072, 1, 0, 0, 1, 0, 1),
  -- Cerebras (OpenAI-compatible)
  ('model-cerebras-llama', 'cerebras', 'llama-3.3-70b', 'Llama 3.3 70B',
   '["chat","coding","reasoning","tools"]', 131072, 1, 1, 0, 1, 0, 1),
  ('model-cerebras-qwen', 'cerebras', 'qwen-3-32b', 'Qwen 3 32B',
   '["chat","coding","reasoning","tools"]', 131072, 1, 1, 0, 1, 0, 1),
  ('model-cerebras-oss', 'cerebras', 'gpt-oss-120b', 'GPT-OSS 120B',
   '["chat","coding","reasoning","tools"]', 131072, 1, 1, 0, 1, 0, 1),
  -- OpenRouter (OpenAI-compatible; :free models rotate — verify live)
  ('model-or-r1', 'openrouter', 'deepseek/deepseek-r1:free', 'DeepSeek R1 (free)',
   '["chat","reasoning","coding"]', 163840, 1, 0, 0, 1, 0, 1),
  ('model-or-llama', 'openrouter', 'meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B Instruct (free)',
   '["chat","coding","tools"]', 131072, 1, 1, 0, 1, 0, 1),
  ('model-or-qwen', 'openrouter', 'qwen/qwen3-235b-a22b:free', 'Qwen3 235B (free)',
   '["chat","reasoning","coding"]', 262144, 1, 0, 0, 1, 0, 1),
  ('model-or-gemma', 'openrouter', 'google/gemma-3-27b-it:free', 'Gemma 3 27B IT (free)',
   '["chat","vision"]', 131072, 1, 0, 1, 1, 0, 1),
  -- Mistral (OpenAI-compatible)
  ('model-mistral-small', 'mistral', 'mistral-small-latest', 'Mistral Small',
   '["chat","coding","tools","structured_outputs"]', 131072, 1, 1, 0, 1, 0, 1),
  ('model-mistral-codestral', 'mistral', 'codestral-latest', 'Codestral',
   '["chat","coding"]', 262144, 1, 0, 0, 1, 0, 1),
  ('model-mistral-medium', 'mistral', 'mistral-medium-latest', 'Mistral Medium',
   '["chat","coding","reasoning","tools","structured_outputs"]', 131072, 1, 1, 0, 1, 0, 1),
  -- Hugging Face Inference API (OpenAI-compatible chat route)
  ('model-hf-llama8b', 'huggingface', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'Meta Llama 3.1 8B Instruct',
   '["chat","coding"]', 131072, 1, 0, 0, 1, 0, 1),
  ('model-hf-qwen72b', 'huggingface', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen 2.5 72B Instruct',
   '["chat","coding","reasoning"]', 32768, 1, 0, 0, 1, 0, 1),
  ('model-hf-r1', 'huggingface', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', 'DeepSeek R1 Distill Qwen 32B',
   '["chat","reasoning"]', 32768, 1, 0, 0, 1, 0, 1),
  -- Cloudflare Workers AI (binding, no API key)
  ('model-cf-llama', 'cloudflare', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B (Workers AI)',
   '["chat","coding"]', 32768, 1, 0, 0, 1, 0, 1),
  ('model-cf-qwen', 'cloudflare', '@cf/qwen/qwen3-32b', 'Qwen3 32B (Workers AI)',
   '["chat","coding","reasoning"]', 32768, 1, 0, 0, 1, 0, 1),
  ('model-cf-gemma', 'cloudflare', '@cf/google/gemma-3-12b-it', 'Gemma 3 12B IT (Workers AI)',
   '["chat","vision"]', 32768, 1, 0, 1, 1, 0, 1);

-- Default chain for the "auto" profile (order matters; router picks the
-- first healthy candidate, then falls back in order).
INSERT OR IGNORE INTO profile_models (profile_id, model_id, position) VALUES
  ('profile-auto', 'model-gemini-flash', 1),
  ('profile-auto', 'model-groq-llama-70b', 2),
  ('profile-auto', 'model-cerebras-llama', 3),
  ('profile-auto', 'model-or-r1', 4),
  ('profile-fast', 'model-groq-llama-8b', 1),
  ('profile-fast', 'model-cerebras-llama', 2),
  ('profile-fast', 'model-gemini-flash-lite', 3),
  ('profile-coding', 'model-groq-llama-70b', 1),
  ('profile-coding', 'model-mistral-codestral', 2),
  ('profile-coding', 'model-gemini-flash', 3),
  ('profile-reasoning', 'model-gemini-flash', 1),
  ('profile-reasoning', 'model-or-r1', 2),
  ('profile-reasoning', 'model-groq-qwq', 3);

-- Provider status rows start as "not_configured" until a key is added
-- and tested. Never seed a provider as operational.
INSERT OR IGNORE INTO provider_status (provider, status) VALUES
  ('gemini', 'not_configured'),
  ('groq', 'not_configured'),
  ('cerebras', 'not_configured'),
  ('openrouter', 'not_configured'),
  ('mistral', 'not_configured'),
  ('huggingface', 'not_configured'),
  ('cloudflare', 'not_configured');
