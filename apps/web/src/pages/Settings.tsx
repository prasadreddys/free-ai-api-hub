// FREE AI API HUB — Settings page.
// Prompt logging, log retention, rate limits, and the config export.

import { useEffect, useState } from "react";
import { settingsApi } from "../lib/api";
import { Card, CardHeader, Spinner } from "../components/ui";

export function SettingsPage() {
  const [storePrompts, setStorePrompts] = useState(false);
  const [retention, setRetention] = useState("30");
  const [rpm, setRpm] = useState("120");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await settingsApi.get();
        if (cancelled) return;
        setStorePrompts(res.settings.store_prompts === "1");
        setRetention(res.settings.log_retention_days ?? "30");
        setRpm(res.settings.rate_limit_rpm ?? "120");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      await settingsApi.update({
        store_prompts: storePrompts ? "1" : "0",
        log_retention_days: String(Math.max(1, Math.min(365, Number.parseInt(retention, 10) || 30))),
        rate_limit_rpm: String(Math.max(1, Math.min(1000, Number.parseInt(rpm, 10) || 120))),
      });
      setMessage("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const downloadExport = async () => {
    // Fetch with the session token as a Bearer header (never in the URL),
    // then trigger a blob download in the browser.
    setError(null);
    const token = sessionStorage.getItem("fai_admin_token");
    try {
      const res = await fetch(settingsApi.exportUrl(), {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `free-ai-api-hub-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  if (loading) return <Spinner label="Loading settings…" />;

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}

      <Card>
        <CardHeader title="Logging" subtitle="Prompt content is off by default. Metadata (provider, model, tokens, latency, status) is always logged." />
        <div className="space-y-4 px-5 py-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={storePrompts}
              onChange={(e) => setStorePrompts(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Store prompt and response text</span>
              <span className="block text-slate-500 dark:text-slate-400">
                When on, request logs keep the prompt and response text (pruned after the retention window). When off,
                only metadata is kept. Changing this affects new requests only.
              </span>
            </span>
          </label>
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            <span className="font-medium">Log retention (days, 1–365)</span>
            <input
              type="number"
              value={retention}
              min={1}
              max={365}
              onChange={(e) => setRetention(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="Rate limits" subtitle="Per unified key. Applies to /v1/chat/completions and /v1/test." />
        <div className="px-5 py-4">
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            <span className="font-medium">Requests per minute</span>
            <input
              type="number"
              value={rpm}
              min={1}
              max={1000}
              onChange={(e) => setRpm(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            A per-key daily limit can also be set when a unified key is created (API Keys page).
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Config export" subtitle="Download the gateway config as JSON (admin only)." />
        <div className="px-5 py-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            The export contains provider keys as encrypted ciphertext (useless without the ENCRYPTION_KEY secret),
            routing profiles, unified-key metadata, and settings. Full unified keys and their hashes are never
            exported.
          </p>
          <button
            type="button"
            onClick={downloadExport}
            className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Download config export
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader title="About this deployment" subtitle="What is running, and what is not." />
        <div className="space-y-2 px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
          <p>• FREE AI API HUB v1 — single-user gateway. Cloudflare Pages (frontend) + Workers (gateway) + D1 (database) + KV (cooldowns) + Workers AI binding.</p>
          <p>• Cohere, Z.ai, and NVIDIA are intentionally held back in v1 (provider terms / evaluation-only use).</p>
          <p>• The encryption key (ENCRYPTION_KEY) cannot be rotated from the dashboard in v1. Rotating it requires re-adding every provider key with the new secret.</p>
          <p>• No paid service is required. The free tier limits are: 100,000 Worker requests/day, 1,000 KV writes/day, 5M D1 rows read/day.</p>
        </div>
      </Card>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
