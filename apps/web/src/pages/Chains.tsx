// FREE AI API HUB — Fallback Chains page.
// Routing profiles: a strategy and an ordered list of model ids. For an
// `auto` request the gateway tries those models in order (max 5 attempts).
// For a specific model the gateway tries that model's providers.

import { useEffect, useState } from "react";
import { modelsApi, profilesApi } from "../lib/api";
import { Badge, Card, CardHeader, EmptyState, Spinner } from "../components/ui";
import type { ModelInfo, RoutingProfile, RouterStrategy } from "@free-ai-api-hub/shared";

const STRATEGIES: { id: RouterStrategy; label: string; hint: string }[] = [
  { id: "best_available", label: "Best available", hint: "Verified models first, then the highest recent success rate, then the lowest latency." },
  { id: "fastest", label: "Fastest", hint: "Prefers the lowest-latency models first (by recent average latency)." },
  { id: "round_robin", label: "Round robin", hint: "Rotates the starting model so load spreads across the chain." },
  { id: "manual_priority", label: "Manual priority", hint: "Strictly follows the chain order you set." },
];

interface EditorState {
  id: string | null;
  name: string;
  strategy: RouterStrategy;
  retry_limit: number;
  timeout_ms: number;
  cooldown_ms: number;
  models: string[];
  is_default: boolean;
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  name: "",
  strategy: "best_available",
  retry_limit: 5,
  timeout_ms: 30000,
  cooldown_ms: 60000,
  models: ["gemini-2.5-flash"],
  is_default: false,
};

export function ChainsPage() {
  const [profiles, setProfiles] = useState<RoutingProfile[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [p, m] = await Promise.all([profilesApi.list(), modelsApi.list()]);
      setProfiles(p.profiles);
      setModels(m.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chains");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startNew = () => setEditor({ ...EMPTY_EDITOR });
  const startEdit = (p: RoutingProfile) => {
    setEditor({
      id: p.id,
      name: p.name,
      strategy: p.strategy,
      retry_limit: p.retry_limit,
      timeout_ms: p.timeout_ms,
      cooldown_ms: p.cooldown_ms,
      models: p.models.length > 0 ? [...p.models] : ["gemini-2.5-flash"],
      is_default: p.is_default,
    });
  };

  const save = async () => {
    if (!editor) return;
    const chain = editor.models.filter((m) => m.trim() !== "");
    if (chain.length === 0) {
      setError("Add at least one model to the chain.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: editor.name.trim(),
        strategy: editor.strategy,
        retry_limit: Math.min(5, Math.max(1, editor.retry_limit)),
        timeout_ms: Math.min(120000, Math.max(1000, editor.timeout_ms)),
        cooldown_ms: Math.max(0, editor.cooldown_ms),
        models: chain,
        is_default: editor.is_default,
      };
      if (editor.id) await profilesApi.update(editor.id, payload);
      else await profilesApi.create(payload);
      setEditor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the profile");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: RoutingProfile) => {
    if (!window.confirm(`Delete the "${p.name}" profile?`)) return;
    try {
      await profilesApi.remove(p.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the profile");
    }
  };

  const moveModel = (index: number, direction: -1 | 1) => {
    if (!editor) return;
    const next = [...editor.models];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setEditor({ ...editor, models: next });
  };

  if (loading) return <Spinner label="Loading chains…" />;

  const modelLabel = (modelId: string) => {
    const m = models.find((x) => x.model_id === modelId);
    return m ? `${m.display_name} (${m.provider})` : modelId;
  };

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      {profiles.length === 0 && !editor ? (
        <Card>
          <EmptyState
            title="No routing profiles"
            body="Profiles decide which models the gateway tries for an `auto` request, in which order. The defaults are seeded by the D1 migrations; if none are listed, the migrations did not run."
            action={
              <button
                type="button"
                onClick={startNew}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
              >
                Create a profile
              </button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {profiles.map((p) => (
            <Card key={p.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">
                    {p.name} {p.is_default ? <Badge tone="violet">Default</Badge> : null}
                  </h3>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    {STRATEGIES.find((s) => s.id === p.strategy)?.label ?? p.strategy} · up to{" "}
                    {p.retry_limit} attempts · {Math.round(p.timeout_ms / 1000)}s per attempt
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  {!p.is_default ? (
                    <button
                      type="button"
                      onClick={() => void remove(p)}
                      className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
              <ol className="mt-3 space-y-1.5">
                {p.models.map((modelId, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold dark:bg-slate-800">
                      {i + 1}
                    </span>
                    <span className="font-mono text-xs">{modelId}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{modelLabel(modelId)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Use it with <code>model: "auto:{p.name === "auto" ? "" : p.name}"</code>
                {p.name === "auto" ? ' (or just "auto")' : ""} — the gateway tries these models in order.
              </p>
            </Card>
          ))}
          <Card className="flex items-center justify-center px-5 py-4">
            <button
              type="button"
              onClick={startNew}
              className="rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              + New profile
            </button>
          </Card>
        </div>
      )}

      {editor ? (
        <Card>
          <CardHeader title={editor.id ? `Edit profile — ${editor.name}` : "New profile"} subtitle="The gateway tries these models in order for an `auto` request (max 5 attempts)." />
          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Name</span>
                <input
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder="e.g. fast"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Strategy</span>
                <select
                  value={editor.strategy}
                  onChange={(e) => setEditor({ ...editor, strategy: e.target.value as RouterStrategy })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                >
                  {STRATEGIES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {STRATEGIES.find((s) => s.id === editor.strategy)?.hint}
            </p>
            <div>
              <p className="mb-2 text-sm font-medium">Chain (model ids, in order)</p>
              <div className="space-y-2">
                {editor.models.map((modelId, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold dark:bg-slate-800">
                      {i + 1}
                    </span>
                    <select
                      value={modelId}
                      onChange={(e) => {
                        const next = [...editor.models];
                        next[i] = e.target.value;
                        setEditor({ ...editor, models: next });
                      }}
                      className="min-w-64 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="">Select a model…</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.model_id}>
                          {m.display_name} ({m.provider}) — {m.model_id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => moveModel(i, -1)}
                      disabled={i === 0}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
                      aria-label={`Move step ${i + 1} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveModel(i, 1)}
                      disabled={i === editor.models.length - 1}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
                      aria-label={`Move step ${i + 1} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = editor.models.filter((_, j) => j !== i);
                        setEditor({ ...editor, models: next.length > 0 ? next : [""] });
                      }}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                      aria-label={`Remove step ${i + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setEditor({ ...editor, models: [...editor.models, ""] })}
                disabled={editor.models.length >= 5}
                className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                + Add model {editor.models.length >= 5 ? "(max 5)" : ""}
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Max attempts (1–5)</span>
                <input
                  type="number"
                  value={editor.retry_limit}
                  min={1}
                  max={5}
                  onChange={(e) => setEditor({ ...editor, retry_limit: Number.parseInt(e.target.value, 10) || 1 })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Timeout per attempt (ms)</span>
                <input
                  type="number"
                  value={editor.timeout_ms}
                  min={1000}
                  max={120000}
                  step={1000}
                  onChange={(e) => setEditor({ ...editor, timeout_ms: Number.parseInt(e.target.value, 10) || 30000 })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Cooldown (ms)</span>
                <input
                  type="number"
                  value={editor.cooldown_ms}
                  min={0}
                  step={1000}
                  onChange={(e) => setEditor({ ...editor, cooldown_ms: Number.parseInt(e.target.value, 10) || 0 })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editor.is_default}
                onChange={(e) => setEditor({ ...editor, is_default: e.target.checked })}
              />
              Make this the default profile (used for plain <code>auto</code> requests)
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !editor.name.trim()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
