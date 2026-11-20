-- FREE AI API HUB — D1 migration 0004: prompt/response logging columns.
-- request_logs gains prompt_text and response_text. They are written ONLY
-- when system_settings.store_prompts = 1 (default 0); the router leaves
-- them NULL otherwise. Pruned by the daily cron with the other logs.

ALTER TABLE request_logs ADD COLUMN prompt_text TEXT;
ALTER TABLE request_logs ADD COLUMN response_text TEXT;
