# FREE AI API HUB

A production-ready, zero-cost AI API aggregation platform. One unified
OpenAI-compatible gateway where a single user connects their own free-tier
AI provider keys, manages models, and accesses multiple AI providers
through a single API — with smart routing, fallback chains, usage
analytics, and a built-in playground.

**Stack (free tier only):** Cloudflare Pages (React + Vite + Tailwind) ·
Cloudflare Workers (TypeScript gateway) · Cloudflare D1 (database) ·
Cloudflare KV (cooldowns/config only) · Workers AI (Cloudflare provider).

**Status:** v1, built locally. Not yet deployed. See
[docs/deployment.md](docs/deployment.md) for the deploy checklist.

## What it does

- **Unified API** — OpenAI-compatible `POST /v1/chat/completions`
  (streaming + non-streaming), `GET /v1/models`, `GET /v1/usage`,
  `GET /v1/providers`, `POST /v1/keys`, `DELETE /v1/keys/:id`,
  `POST /v1/test`, `GET /v1/health`. One unified key (`fai_live_…`)
  for all providers; provider keys are never exposed to clients.
- **Provider adapters** — generic OpenAI-compatible adapter (Groq,
  Cerebras, OpenRouter, Mistral, custom endpoints) + bespoke Gemini
  adapter. Cohere, Z.ai, and NVIDIA are **held** in v1 (terms-of-use
  flags — see [docs/providers.md](docs/providers.md)).
- **Smart router** — strategies (best available, fastest, round robin,
  manual priority), configurable fallback chains, max 5 attempts,
  cooldowns, never routes to a known-failed key or exhausted quota.
  A specific model request tries only that model's providers; cross-model
  fallback runs for `auto` / `auto:<profile>` requests.
- **Key management** — provider keys encrypted at rest (AES-256-GCM),
  masked display, live validation before storage, test/enable/disable/
  remove, priorities. Unified keys (`fai_live_…`) are SHA-256 hash-stored,
  shown once, revocable and rotatable.
- **Dashboard, playground, chain builder, analytics, docs** — all fed by
  the real gateway. Empty accounts show honest zero states; nothing is
  fabricated.

## Honesty rules

- A provider/model is listed as operational **only after a real test**
  passes. Everything else is labeled "not verified" with the last
  check time. Capabilities that are not live-verified are labeled
  "manually configured".
- No fake providers, models, quotas, or usage numbers. No mock API
  responses presented as real. Prompt content is **not** stored unless
  the user explicitly enables it.
- No paid services anywhere. No secrets in the repo.

## Repo layout

```
free-ai-api-hub/
  apps/web/            # Pages frontend (React + Vite + Tailwind)
  workers/api/         # Gateway Worker (routes, router, adapters)
    src/adapters/      # one module per provider + openai-compat base
    src/lib/           # crypto, ssrf-guard, validation, errors, sse
    src/routes/        # /v1/* and /api/* handlers
    test/              # vitest suite (mocked upstreams, real SQLite D1)
  packages/shared/     # types shared by web and worker
  migrations/          # D1 SQL migrations (0001–0004)
  docs/                # deployment checklist, providers, known gaps
  wrangler.toml        # worker bindings (D1, KV, AI, secrets)
```

## Verification (all green, 19 Nov 2026)

- Worker tests: **75 passing** (`npm run test --workspace=workers/api`) —
  crypto, SSRF guard, adapters, router (fallback, cooldowns, streaming),
  routes (auth, keys, unified keys, rate limits). Mocked upstreams only;
  D1 is real SQLite (`node:sqlite`), KV is a real Map-backed fake.
- Typechecks: worker + web clean (`npm run typecheck`).
- Web build: clean (`npm run build --workspace=apps/web`, 297 KiB JS,
  87.8 KiB gzip).
- Wrangler dry-run: Worker bundles to 126 KiB (26 KiB gzip), bindings
  resolve (DB, KV, AI).

## Development (local only, no deploy)

```bash
npm install
npm test                 # worker unit + integration tests (mocked upstreams)
npm run typecheck        # worker + web typechecks
npm run build:web        # frontend production build check
```

Tests use mocked upstream responses only — no real provider keys.
See [docs/deployment.md](docs/deployment.md) for the deploy checklist
(Wrangler commands, D1/KV resources, secrets — names only) and
[docs/known-gaps.md](docs/known-gaps.md) for the v1 deviations.

## License

MIT. Independent implementation; inspired by (not copied from) the
architecture of freellmapi. See [docs/providers.md](docs/providers.md)
for the per-provider terms notes.
