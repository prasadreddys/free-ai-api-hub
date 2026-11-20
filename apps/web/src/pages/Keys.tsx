// FREE AI API HUB — API Keys page.
// Provider keys: added with live validation, encrypted at rest, only ever
// shown masked. Unified keys: created once, shown once, hash-stored.

import { useEffect, useState } from "react";
import { keysApi, unifiedKeysApi } from "../lib/api";
import { Badge, Card, CardHeader, CopyButton, EmptyState, Modal, Spinner } from "../components/ui";
import type { ProviderKeyInfo, UnifiedKeyInfo } from "@free-ai-api-hub/shared";

const PROVIDER_OPTIONS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "groq", label: "Groq" },
  { id: "cerebras", label: "Cerebras" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "mistral", label: "Mistral" },
  { id: "huggingface", label: "Hugging Face" },
  { id: "cloudflare", label: "Cloudflare Workers AI (keyless)" },
  { id: "custom", label: "Custom (OpenAI-compatible)" },
];

const STATUS_TONE: Record<ProviderKeyInfo["status"], "green" | "amber" | "red" | "slate"> = {
  healthy: "green",
  cooldown: "amber",
  error: "red",
  auth_failed: "red",
  not_verified: "slate",
};

export function KeysPage() {
  const [providerKeys, setProviderKeys] = useState<ProviderKeyInfo[]>([]);
  const [unifiedKeys, setUnifiedKeys] = useState<UnifiedKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-provider-key form.
  const [provider, setProvider] = useState("gemini");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [priority, setPriority] = useState(100);
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  // Unified key form + one-time display.
  const [ukName, setUkName] = useState("");
  const [ukLimit, setUkLimit] = useState("");
  const [creatingUk, setCreatingUk] = useState(false);
  const [newUk, setNewUk] = useState<{ key: string; info: UnifiedKeyInfo } | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);

  const load = async () => {
    try {
      const [pk, uk] = await Promise.all([keysApi.list(), unifiedKeysApi.list()]);
      setProviderKeys(pk.keys);
      setUnifiedKeys(uk.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addProviderKey = async () => {
    setAddError(null);
    setAdding(true);
    try {
      const res = await keysApi.add({
        provider,
        key: key.trim(),
        label: label.trim() || undefined,
        priority,
        base_url: provider === "custom" ? baseUrl.trim() || undefined : undefined,
        model_id: provider === "custom" ? modelId.trim() || undefined : undefined,
      });
      setProviderKeys((prev) => [res.key, ...prev]);
      setKey("");
      setLabel("");
      setBaseUrl("");
      setModelId("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add the key");
    } finally {
      setAdding(false);
    }
  };

  const testKey = async (id: string) => {
    setTesting(id);
    try {
      const res = await keysApi.test(id);
      await load();
      if (!res.valid) setError(`Key test failed: ${res.error ?? "upstream rejected the key"}`);
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Key test failed");
    } finally {
      setTesting(null);
    }
  };

  const deleteKey = async (id: string) => {
    if (!window.confirm("Delete this provider key? The gateway will stop routing to it.")) return;
    try {
      await keysApi.remove(id);
      setProviderKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the key");
    }
  };

  const createUnifiedKey = async () => {
    setCreatingUk(true);
    try {
      const res = await unifiedKeysApi.create(ukName.trim(), ukLimit ? Number.parseInt(ukLimit, 10) : null);
      setNewUk(res);
      setUkName("");
      setUkLimit("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the unified key");
    } finally {
      setCreatingUk(false);
    }
  };

  const revokeUnifiedKey = async (id: string) => {
    if (!window.confirm("Revoke this unified key? Apps using it will stop working immediately.")) return;
    try {
      await unifiedKeysApi.revoke(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke the key");
    }
  };

  const rotateUnifiedKey = async (id: string) => {
    if (!window.confirm("Rotate this key? The old key stops working and a new one is issued.")) return;
    setRotating(id);
    try {
      const res = await unifiedKeysApi.rotate(id);
      setNewUk(res);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate the key");
    } finally {
      setRotating(null);
    }
  };

  if (loading) return <Spinner label="Loading keys…" />;

  const isKeyless = provider === "cloudflare";

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      <Card>
        <CardHeader
          title="Provider keys"
          subtitle="Your own free-tier keys. Validated live before they are stored, encrypted at rest, never shown in full."
        />
        <div className="space-y-3 px-5 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Provider</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Label (optional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Personal Gemini key"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
          </div>
          {isKeyless ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Cloudflare Workers AI needs no key — the Workers AI binding is the credential. Adding it enables the
              cloudflare provider.
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">API key</span>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste your provider API key"
                autoComplete="off"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
          )}
          {provider === "custom" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Model id</span>
                <input
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="e.g. llama-3.3-70b-instruct"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
            </div>
          ) : null}
          <div className="flex items-end gap-3">
            <label className="flex w-32 flex-col gap-1 text-sm">
              <span className="font-medium">Priority</span>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number.parseInt(e.target.value, 10) || 100)}
                min={0}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <button
              type="button"
              onClick={() => void addProviderKey()}
              disabled={adding || (!isKeyless && !key.trim()) || (provider === "custom" && !baseUrl.trim())}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {adding ? "Validating…" : "Add key (validates live)"}
            </button>
          </div>
          {addError ? <p className="text-sm text-rose-600 dark:text-rose-400">{addError}</p> : null}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The key is validated with a tiny probe completion before anything is stored. A failed validation stores
            nothing and shows the upstream error. Lower priority numbers are tried first.
          </p>
        </div>

        {providerKeys.length === 0 ? (
          <EmptyState
            title="No provider keys yet"
            body="Add your first free-tier key above. Until a key exists, the gateway has nothing to route to and every model shows as unavailable."
          />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {providerKeys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">
                    <span className="capitalize">{k.provider}</span>
                    {k.label ? ` — ${k.label}` : ""}
                  </p>
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {k.key_masked} · priority {k.priority}
                    {k.last_tested_at ? ` · tested ${new Date(k.last_tested_at).toLocaleString()}` : ""}
                    {k.last_error ? ` · ${k.last_error}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[k.status]}>{k.status.replace(/_/g, " ")}</Badge>
                  <button
                    type="button"
                    onClick={() => void testKey(k.id)}
                    disabled={testing === k.id}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    {testing === k.id ? "Testing…" : "Test"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteKey(k.id)}
                    className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Unified gateway keys"
          subtitle="The single key your apps use. One key, one endpoint — the gateway routes it to any provider."
        />
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Key name</span>
            <input
              value={ukName}
              onChange={(e) => setUkName(e.target.value)}
              placeholder="e.g. My app"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="flex w-40 flex-col gap-1 text-sm">
            <span className="font-medium">Daily limit (optional)</span>
            <input
              type="number"
              value={ukLimit}
              onChange={(e) => setUkLimit(e.target.value)}
              placeholder="Unlimited"
              min={1}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <button
            type="button"
            onClick={() => void createUnifiedKey()}
            disabled={creatingUk || !ukName.trim()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {creatingUk ? "Creating…" : "Create key"}
          </button>
        </div>
        {unifiedKeys.length === 0 ? (
          <EmptyState
            title="No unified keys yet"
            body="Create one above. It is shown exactly once — copy it immediately and store it in your app's config."
          />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {unifiedKeys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{k.name}</p>
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {k.prefix}… · {k.request_count.toLocaleString()} requests
                    {k.daily_limit ? ` · ${k.daily_limit.toLocaleString()}/day` : " · no daily limit"}
                    {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : " · never used"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {k.revoked ? (
                    <Badge tone="red">Revoked</Badge>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void rotateUnifiedKey(k.id)}
                        disabled={rotating === k.id}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                      >
                        {rotating === k.id ? "Rotating…" : "Rotate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void revokeUnifiedKey(k.id)}
                        className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {newUk ? (
        <Modal title="Your unified key — copy it now" onClose={() => setNewUk(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This is the only time the full key is shown. Store it in your app's config; the gateway only stores a
            hash.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm break-all dark:bg-slate-800">
            <span className="flex-1">{newUk.key}</span>
            <CopyButton text={newUk.key} />
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Name: {newUk.info.name} · Prefix: {newUk.info.prefix}…
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
