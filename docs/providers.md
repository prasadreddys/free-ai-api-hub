# FREE AI API HUB — Providers

How each provider is wired, what free tier it uses, and the terms notes
that matter. The catalog in `migrations/0002_seed_models.sql` is
manually configured (all rows `verified = 0`); a model is operational
only after a real key validation + probe completion passes.

## Built-in providers

| Provider | Adapter | Base URL | Key needed | Free tier (as configured) |
|---|---|---|---|---|
| Google Gemini | bespoke | `generativelanguage.googleapis.com/v1beta` | Yes | Gemini API free tier |
| Groq | OpenAI-compatible | `api.groq.com/openai/v1` | Yes | Groq free tier |
| Cerebras | OpenAI-compatible | `api.cerebras.ai/v1` | Yes | Cerebras free tier |
| OpenRouter | OpenAI-compatible | `openrouter.ai/api/v1` | Yes | `:free` models only |
| Mistral | OpenAI-compatible | `api.mistral.ai/v1` | Yes | Mistral free tier (La Plateforme) |
| Hugging Face | OpenAI-compatible | `router.huggingface.co/v1` | Yes | Inference API free tier |
| Cloudflare Workers AI | binding | (none — `env.AI`) | No | Workers AI free tier (10,000 neurons/day) |
| Custom | OpenAI-compatible | user-supplied `base_url` | Yes | Whatever the endpoint offers |

## Held providers (v1)

These are refused by both the registry (`getAdapter`) and the key-add
validator, so they can never be registered by mistake:

- **Cohere** — ToS §14 (May 2026 review): personal use is flagged
  "Avoid". Held pending a terms review.
- **Z.ai** — caution in the May 2026 ToS review. Held pending review.
- **NVIDIA** — evaluation-only terms. Held pending review.

Revisit only after a fresh ToS read. Do not add them because a key
happens to work — the terms, not the API, are the blocker.

## Terms notes (from the May 2026 review)

- **Gemini** — the 2026 ToS narrows the free tier toward business use.
  The user already holds a Gemini key; the gateway uses it as the user
  directs, and the user is responsible for their own provider terms.
- **OpenRouter `:free` models** — the free model list rotates. A model
  that was free can leave the free tier; the gateway does not promise
  it stays free. Re-verify live (the key test does this).
- **Hugging Face** — the Inference API free tier is rate-limited and
  the model list changes. Same re-verify rule.
- **Cloudflare Workers AI** — no key; the Workers AI binding is the
  credential. Token counts are not reported (recorded as zero, honestly).

## Custom providers

A custom provider is any OpenAI-compatible endpoint. When adding one:
- `base_url` is required (e.g. `https://api.example.com/v1`).
- `model_id` is the model to probe with (and the model the gateway
  calls). It is added to the catalog as `verified = 0` until the probe
  passes.
- The URL is SSRF-checked at save time (https only, no credentials,
  no blocked hostname, DNS-resolved and every IP classified). The check
  runs again at request time in the router (the adapter builds the URL
  from the stored `base_url`, which was validated at save).

## Key validation (how "verified" is earned)

Adding a provider key runs a live probe completion (`max_tokens = 1`)
against a real model id before anything is stored:
- Success (HTTP 200) → key stored, model marked verified.
- HTTP 429 → the key is valid but rate-limited; stored, model verified.
- HTTP 401/403 → invalid; nothing is stored, the upstream error is shown.
- Any other error → invalid; nothing is stored.

Re-testing a stored key (`POST /api/keys/:id/test`) does the same probe
and updates the key's status and the model's verified flag.
