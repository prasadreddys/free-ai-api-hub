-- FREE AI API HUB — D1 migration 0001: initial schema
-- Single-user v1. Prompt/response content is NOT stored unless the user
-- explicitly enables it (system_settings.store_prompts = 0 by default).
-- Log retention is enforced by the daily cron (default 30 days).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT,
  key_encrypted TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_tag TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  key_masked TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'not_verified',
  last_tested_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider_enabled
  ON provider_keys (provider, enabled);

CREATE TABLE IF NOT EXISTS unified_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_unified_keys_hash ON unified_api_keys (key_hash);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '["chat"]',
  context_window INTEGER,
  supports_streaming INTEGER NOT NULL DEFAULT 1,
  supports_tools INTEGER NOT NULL DEFAULT 0,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  free_tier INTEGER NOT NULL DEFAULT 1,
  verified INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  last_error TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (provider, model_id)
);
CREATE INDEX IF NOT EXISTS idx_models_provider_enabled
  ON models (provider, enabled);
CREATE INDEX IF NOT EXISTS idx_models_verified ON models (verified);

CREATE TABLE IF NOT EXISTS routing_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  strategy TEXT NOT NULL DEFAULT 'best_available',
  retry_limit INTEGER NOT NULL DEFAULT 5,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  cooldown_ms INTEGER NOT NULL DEFAULT 60000,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profile_models (
  profile_id TEXT NOT NULL REFERENCES routing_profiles (id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (profile_id, model_id)
);

-- One row per completed request (usage + routing outcome).
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  unified_key_id TEXT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  routed_via TEXT,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  error_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_usage_provider_model
  ON usage_logs (provider, model_id);
CREATE INDEX IF NOT EXISTS idx_usage_key ON usage_logs (unified_key_id);

-- One row per attempt (including failed attempts inside a fallback chain).
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  unified_key_id TEXT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_type TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_request_logs_request
  ON request_logs (request_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created
  ON request_logs (created_at);

CREATE TABLE IF NOT EXISTS provider_status (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'not_configured',
  last_check_at TEXT,
  last_error TEXT,
  quota_remaining INTEGER,
  quota_reset_at TEXT
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hourly_rollups (
  hour TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  latency_p50 INTEGER,
  latency_p95 INTEGER,
  PRIMARY KEY (hour, provider, model_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);

-- Defaults: prompt storage OFF, 30-day retention, default profile limits.
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('store_prompts', '0'),
  ('log_retention_days', '30'),
  ('max_fallback_attempts', '5'),
  ('default_timeout_ms', '30000'),
  ('rate_limit_rpm', '120');

-- Default routing profile (chain is seeded in 0002 with the catalog).
INSERT OR IGNORE INTO routing_profiles
  (id, name, strategy, retry_limit, timeout_ms, cooldown_ms, is_default)
VALUES
  ('profile-auto', 'auto', 'best_available', 5, 30000, 60000, 1),
  ('profile-fast', 'fast', 'fastest', 5, 20000, 60000, 0),
  ('profile-coding', 'coding', 'manual_priority', 5, 60000, 60000, 0),
  ('profile-reasoning', 'reasoning', 'best_available', 5, 60000, 60000, 0);
