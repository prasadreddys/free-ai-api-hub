# FREE AI API HUB — Known gaps and deliberate deviations (v1)

Things that differ from the design doc, or that a reviewer should know
about. Nothing here is a secret; each item is a choice or a limit.

## 1. `profile.cooldown_ms` is stored but not used by the router

The `routing_profiles.cooldown_ms` field exists in the schema and the
dashboard lets you set it, but the router derives cooldowns from the
upstream instead: `Retry-After` headers, `retryDelay` fields, and prose
("try again in 1m26s") via `parseBackoffSeconds`, defaulting to 60 s.
Wiring `cooldown_ms` in as a per-profile floor is a small follow-up.

## 2. The SSRF guard does not restrict ports

`validateProviderUrl` allows any port on a public host (e.g.
`https://api.example.com:8443/v1`). Internal services are still blocked
by the hostname + DNS/IP checks (loopback, private, link-local, CGNAT,
metadata). A port allowlist (443 only) is a hardening follow-up, not a
v1 blocker — a TLS handshake to a wrong port fails anyway.

## 3. A specific model request does not fall back to other models

`model: "llama-3.3-70b-versatile"` tries only that model's providers
(Groq keys, in priority order). If they all fail, the request 502s —
it does NOT silently substitute Gemini. Cross-model fallback happens
only for `auto` / `auto:<profile>` requests, which walk the profile's
model list in order. This is deliberate: asking for a model means
asking for that model.

## 4. ENCRYPTION_KEY rotation is manual

Rotating the `ENCRYPTION_KEY` secret orphans every stored provider key
(they decrypt to garbage). There is no dashboard rotation flow in v1.
To rotate: set the new secret, then re-add every provider key.
Unified keys (SHA-256 hashes) and admin accounts (PBKDF2) are unaffected.

## 5. Workers AI reports zero tokens

The Cloudflare Workers AI binding does not return token counts, so usage
for `cloudflare` models is recorded as 0/0/0. This is honest, never
fabricated, and the dashboard labels it. Do not sum Workers AI tokens
into a total and present it as a real count.

## 6. Gemini reports a bad key as HTTP 400

Gemini returns 400 ("API key not valid") for a bad key, not 401. The
Gemini adapter normalizes a 400 whose message mentions an API key to
401, so the router benches the key (`auth_failed`) and falls back
instead of stopping the chain. Other Gemini 400s stay 400.

## 7. `GET /v1/models` returns `created: 0`

The catalog has no creation timestamp per model, so the OpenAI list
shape uses `created: 0`. Clients that sort by `created` will see all
models as equal.

## 8. `auto:fast` / `auto:smart` are special-cased

`model: "auto"` uses the default profile. `auto:fast` and `auto:smart`
map to the "fast" and "smart" profiles respectively (the "smart" profile
does not exist in the seed, so it falls back to the default). Any other
`auto:<name>` looks that profile up by name and 400s when it is missing.

## 9. Hourly rollup percentiles are computed in the cron

`hourly_rollups.latency_p50/p95` are computed in JavaScript from the
raw latencies of that (hour, provider, model) bucket, not in SQL.
Buckets are small (one hour of traffic), so this stays cheap.

## 10. No `ADMIN_PASSWORD_HASH` secret

The wrangler.toml comment in an earlier draft named an
`ADMIN_PASSWORD_HASH` secret. It does not exist and is not used. The
admin account is created with `POST /api/auth/setup` (PBKDF2 hash in
D1). The comment has been corrected.
