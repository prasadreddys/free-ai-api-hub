-- FREE AI API HUB — D1 migration 0003: custom provider base URL
-- Custom (user-defined OpenAI-compatible) providers need a base URL stored
-- alongside the key. Built-in providers use hardcoded base URLs in the
-- adapter registry and never read this column.

ALTER TABLE provider_keys ADD COLUMN base_url TEXT;
ALTER TABLE provider_keys ADD COLUMN model_id TEXT;
