// FREE AI API HUB — Models page.
// Availability is honest: a model is available only when it is enabled,
// live-verified, and a healthy key exists for its provider.

import { useEffect, useState } from "react";
import { modelsApi } from "../lib/api";
import { Badge, Card, EmptyState, Spinner } from "../components/ui";
import type { ModelInfo } from "@free-ai-api-hub/shared";

export function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await modelsApi.list();
      setModels(res.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (model: ModelInfo) => {
    setUpdating(model.id);
    try {
      await modelsApi.setEnabled(model.id, !model.enabled);
      setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, enabled: !m.enabled } : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update the model");
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <Spinner label="Loading models…" />;
  if (error && models.length === 0) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      </Card>
    );
  }

  const byProvider = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) ?? [];
    list.push(m);
    byProvider.set(m.provider, list);
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      {models.length === 0 ? (
        <Card>
          <EmptyState
            title="No models in the catalog"
            body="The catalog is seeded by the D1 migrations. If this is empty, the migrations did not run — see the deploy checklist."
          />
        </Card>
      ) : (
        [...byProvider.entries()].map(([provider, list]) => (
          <Card key={provider}>
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h2 className="text-base font-semibold capitalize">{provider}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {list.filter((m) => m.available).length} of {list.length} available
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-5 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Context</th>
                    <th className="px-3 py-2 font-medium">Capabilities</th>
                    <th className="px-3 py-2 font-medium">Verified</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="px-5 py-3">
                        <p className="font-medium">{m.display_name}</p>
                        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{m.model_id}</p>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {m.context_window ? m.context_window.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {m.capabilities.map((c) => (
                            <Badge key={c} tone="slate">{c}</Badge>
                          ))}
                          {m.supports_streaming ? <Badge tone="cyan">streaming</Badge> : null}
                          {m.supports_tools ? <Badge tone="violet">tools</Badge> : null}
                          {m.supports_vision ? <Badge tone="cyan">vision</Badge> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {m.verified ? (
                          <Badge tone="green">Verified</Badge>
                        ) : (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Unverified
                            {m.last_error ? ` — ${m.last_error}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={m.available ? "green" : "amber"}>
                          {m.available ? "Available" : "Unavailable"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void toggle(m)}
                          disabled={updating === m.id}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            m.enabled ? "bg-violet-600" : "bg-slate-300 dark:bg-slate-600"
                          } disabled:opacity-50`}
                          aria-label={`${m.enabled ? "Disable" : "Enable"} ${m.display_name}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              m.enabled ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        A model becomes available only when it is enabled, live-verified (a real probe completion succeeded), and a
        healthy provider key exists. Catalog entries are manually configured — a model listed here is not a promise
        that the provider offers it on its free tier.
      </p>
    </div>
  );
}
