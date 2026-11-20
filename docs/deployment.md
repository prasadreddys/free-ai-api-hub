# FREE AI API HUB — Deployment Checklist

Deploy is done by the parent with the user's browser. Nothing here deploys
itself. Every step is free-tier only; no card, no paid plan, no paid service.

The repo root is the Wrangler working directory (`wrangler.toml` lives there).
The Worker source is `workers/api/src/index.ts`; the dashboard source is
`apps/web/`; D1 migrations are `migrations/` (repo root).

## 0. Prerequisites

- A Cloudflare account (the user already has one from AURUM).
- Node 20+ and npm. Wrangler is already a devDependency (`npx wrangler`).
- `wrangler login` (or `wrangler login --browser` on a machine with a
  browser) — the account must be the user's, not a shared one.
- The GitHub repo `prasadreddys/free-ai-api-hub` (NOT created yet — the
  parent creates it; the local git repo is ready to push).

## 1. Create the D1 database

```bash
npx wrangler d1 create free-ai-api-hub
```

Copy the `database_id` from the output and put it in `wrangler.toml`
(replace `REPLACE_WITH_D1_DATABASE_ID`).

## 2. Create the KV namespace

```bash
npx wrangler kv namespace create "FREE_AI_API_HUB_KV"
```

Copy the `id` from the output and put it in `wrangler.toml`
(replace `REPLACE_WITH_KV_NAMESPACE_ID`).

KV is used for cooldowns and config only — never per-request counters
(free tier: 1,000 writes/day).

## 3. Set the two secrets

```bash
# ENCRYPTION_KEY — base64, 32 random bytes (AES-256-GCM for provider keys).
openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY

# SESSION_SECRET — random string for signing admin session tokens.
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
```

**ENCRYPTION_KEY cannot be rotated from the dashboard in v1.** Rotating it
orphans every stored provider key (they decrypt to garbage). To rotate:
set the new secret, then re-add every provider key. Unified keys and admin
accounts are unaffected (they are hashes / PBKDF2, not encrypted).

Do NOT store either secret in the repo, in chat, or in a Pages env var.
There is no `ADMIN_PASSWORD_HASH` secret — the admin account is created
in step 6 and its PBKDF2 hash lives in D1.

## 4. Apply the D1 migrations

```bash
# Local (for `wrangler dev` smoke tests):
npx wrangler d1 migrations apply free-ai-api-hub --local

# Remote (the real database):
npx wrangler d1 migrations apply free-ai-api-hub --remote
```

Migrations (in order):
- `0001_init.sql` — schema (users, provider_keys, unified_api_keys, models,
  routing_profiles, profile_models, usage_logs, request_logs,
  provider_status, system_settings, hourly_rollups, audit_log) + defaults
  (store_prompts=0, 30-day retention, 120 rpm) + 4 default profiles.
- `0002_seed_models.sql` — 22-model catalog, ALL `verified = 0`
  (manually configured, not live-verified) + default profile chains +
  provider_status rows (`not_configured`).
- `0003_custom_provider_url.sql` — `base_url` / `model_id` on provider_keys.
- `0004_prompt_logging.sql` — `prompt_text` / `response_text` on
  request_logs (written only when `store_prompts = 1`).

Verify the seed landed:

```bash
npx wrangler d1 execute free-ai-api-hub --remote \
  --command "SELECT COUNT(*) AS models FROM models; SELECT COUNT(*) AS profiles FROM routing_profiles;"
```

Expected: `models = 22`, `profiles = 4`.

## 5. Deploy the Worker

```bash
# From the repo root. Dry-run first to check the bundle:
npx wrangler deploy --dry-run

# Then the real deploy:
npx wrangler deploy
```

Note the Worker URL (e.g. `https://free-ai-api-hub.<subdomain>.workers.dev`).
Verify it is alive:

```bash
curl https://<worker-url>/v1/health
# {"ok":true,"version":"1.0.0","db":"ok","kv":"ok","timestamp":"..."}
```

The Worker is 126 KiB bundled (26 KiB gzip) — well under the 64 MiB
free-tier limit.

## 6. Create the admin account

```bash
curl -X POST https://<worker-url>/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin email>","password":"<at least 12 characters>"}'
```

This works exactly once (it 409s once any admin exists). Save the returned
`token` — it is the admin session token (24 h, HMAC-signed). Sign in to the
dashboard with the same email + password afterwards.

## 7. Deploy the Pages dashboard

The dashboard needs to know the Worker URL at build time
(`VITE_API_URL`). Two routes:

**A. Local build + direct upload (fastest for v1):**

```bash
VITE_API_URL=https://<worker-url> npm run build --workspace=apps/web
npx wrangler pages deploy apps/web/dist --project-name free-ai-api-hub
```

**B. GitHub-connected Pages project (recommended long-term):**
Create a Pages project from the `prasadreddys/free-ai-api-hub` repo with:
- Build command: `npm run build --workspace=apps/web`
- Build output directory: `apps/web/dist`
- Environment variable: `VITE_API_URL=https://<worker-url>`

Either way the site lands on `https://free-ai-api-hub.pages.dev`.

## 8. Add provider keys + create a unified key

In the dashboard (or via the API):
1. API Keys → add a provider key (Gemini first — the user already has a
   Gemini key). The key is validated live before anything is stored; a
   failed validation stores nothing.
2. API Keys → create a unified key. Copy it immediately — it is shown once.
3. Playground → send a test message. It should answer with an
   `X-Routed-Via: provider/model` header.

## 9. Smoke test (curl)

```bash
# Replace FAI_KEY with the unified key from step 8.
curl https://<worker-url>/v1/chat/completions \
  -H "Authorization: Bearer FAI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hello!"}]}' \
  -i
# Expect HTTP 200, an OpenAI-shaped body, and X-Routed-Via: gemini/gemini-2.5-flash

curl https://<worker-url>/v1/models -H "Authorization: Bearer FAI_KEY" | head -c 400
curl "https://<worker-url>/v1/usage?window=24h" -H "Authorization: Bearer FAI_KEY"
```

## 10. Cron triggers (already in wrangler.toml)

- `15 * * * *` — hourly: roll usage into `hourly_rollups`, re-check stale keys.
- `30 2 * * *` — daily: prune logs older than the retention setting.

No action needed; they activate on deploy. Free tier allows 5 cron
triggers per account.

## Free-tier limits this deployment respects

| Resource | Free limit | How the gateway stays inside it |
|---|---|---|
| Workers requests | 100,000/day | Thin gateway; no per-request KV writes |
| KV writes | 1,000/day | Written only on failure (cooldowns) |
| D1 rows read | 5,000,000/day | Indexed queries; rollups hourly |
| D1 rows written | 100,000/day | 2 rows per request (usage + attempt) |
| Workers CPU | 10 ms/request | No heavy work in the request path |
| Subrequests | 50/invocation | Max 5 fallback attempts, sequential |
| Pages | Unlimited static requests | Dashboard is a static SPA |

## What is NOT built (v1 scope)

- Cohere, Z.ai, NVIDIA providers (HELD — terms review; the registry and
  the key-add validator both refuse them).
- Anthropic adapter, Ollama/local endpoints, MCP, embeddings, media.
- Parallel (Fusion) fan-out — sequential fallback only.
- Prompt logging defaults OFF; when ON it stores prompt/response text in
  `request_logs` (migration 0004) and prunes with the retention window.
- The `profile.cooldown_ms` field is stored but the router derives
  cooldowns from upstream `Retry-After` / error text instead (see
  `docs/known-gaps.md` if present, else the README).
- ENCRYPTION_KEY rotation from the dashboard (see step 3).

## Rollback

- Worker: `npx wrangler rollback` (or redeploy the previous git commit).
- Pages: redeploy the previous `apps/web/dist` build.
- D1: migrations are additive (`IF NOT EXISTS` / `ADD COLUMN`); there is
  no down-migration. A bad deploy is fixed by redeploying, not by
  rolling the database back.
