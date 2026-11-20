// FREE AI API HUB — Analytics page.
// Windows: 24h / 7d / 30d. Every number comes from real D1 rows.

import { useEffect, useState } from "react";
import { analyticsApi, type RecentRequest, type TimelinePoint } from "../lib/api";
import { AreaChart } from "../components/Chart";
import { Badge, Card, CardHeader, EmptyState, Spinner, StatCard } from "../components/ui";
import type { UsageSummary } from "@free-ai-api-hub/shared";

const WINDOWS = [
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

function shortHour(iso: string): string {
  const parts = iso.split(" ");
  return parts[1]?.slice(0, 5) ?? iso;
}

export function AnalyticsPage() {
  const [windowId, setWindowId] = useState("24h");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [s, t, r] = await Promise.all([
          analyticsApi.summary(windowId),
          analyticsApi.timeline(windowId),
          analyticsApi.recent(25),
        ]);
        if (cancelled) return;
        setSummary(s);
        setTimeline(t.timeline);
        setRecent(r.recent);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowId]);

  if (loading) return <Spinner label="Loading analytics…" />;

  const successRate =
    summary && summary.total_requests > 0
      ? Math.round((summary.successful_requests / summary.total_requests) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWindowId(w.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              windowId === w.id
                ? "bg-violet-600 text-white"
                : "border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {error ? (
        <Card className="px-5 py-6">
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total requests" value={String(summary?.total_requests ?? 0)} sub={`${summary?.successful_requests ?? 0} succeeded · ${summary?.failed_requests ?? 0} failed`} />
            <StatCard label="Success rate" value={successRate === null ? "—" : `${successRate}%`} sub={successRate === null ? "No requests in this window" : undefined} />
            <StatCard label="Total tokens" value={(summary?.total_tokens ?? 0).toLocaleString()} sub={`${(summary?.prompt_tokens ?? 0).toLocaleString()} prompt · ${(summary?.completion_tokens ?? 0).toLocaleString()} completion`} />
            <StatCard label="Avg latency" value={summary ? `${summary.avg_latency_ms} ms` : "—"} sub={summary ? `${summary.fallback_events} fallback events` : undefined} />
          </div>

          <Card>
            <CardHeader title="Requests over time" subtitle={`Hourly buckets, ${WINDOWS.find((w) => w.id === windowId)?.label.toLowerCase()}.`} />
            <div className="px-5 py-4">
              {timeline.length === 0 || timeline.every((t) => t.requests === 0) ? (
                <EmptyState
                  title="No traffic in this window"
                  body="Usage appears here once the gateway serves requests. Empty windows show honest zeros, not estimates."
                />
              ) : (
                <AreaChart points={timeline.map((t) => ({ label: shortHour(t.hour), requests: t.requests, errors: t.errors }))} />
              )}
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="By provider" subtitle="Requests, tokens and errors per provider." />
              {summary && Object.keys(summary.by_provider).length === 0 ? (
                <EmptyState title="No provider traffic" body="No requests in this window." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="px-5 py-2 font-medium">Provider</th>
                        <th className="px-3 py-2 text-right font-medium">Requests</th>
                        <th className="px-3 py-2 text-right font-medium">Tokens</th>
                        <th className="px-3 py-2 text-right font-medium">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary &&
                        Object.entries(summary.by_provider)
                          .sort((a, b) => b[1].requests - a[1].requests)
                          .map(([provider, v]) => (
                            <tr key={provider} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                              <td className="px-5 py-2 capitalize">{provider}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{v.requests.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{v.tokens.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{v.errors}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="By model" subtitle="Requests, tokens and errors per model." />
              {summary && Object.keys(summary.by_model).length === 0 ? (
                <EmptyState title="No model traffic" body="No requests in this window." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="px-5 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 text-right font-medium">Requests</th>
                        <th className="px-3 py-2 text-right font-medium">Tokens</th>
                        <th className="px-3 py-2 text-right font-medium">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary &&
                        Object.entries(summary.by_model)
                          .sort((a, b) => b[1].requests - a[1].requests)
                          .map(([model, v]) => (
                            <tr key={model} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                              <td className="px-5 py-2 font-mono text-xs">{model}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{v.requests.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{v.tokens.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{v.errors}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Recent requests" subtitle="Latest gateway calls across all unified keys." />
            {recent.length === 0 ? (
              <EmptyState title="No requests yet" body="Recent calls will list here once the gateway serves traffic." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="px-5 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Routed via</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Latency</th>
                      <th className="px-3 py-2 text-right font-medium">Fallbacks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="whitespace-nowrap px-5 py-2 tabular-nums">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.routed_via ?? `${r.provider}/${r.model_id}`}</td>
                        <td className="px-3 py-2">
                          <Badge tone={r.status === "success" ? "green" : r.status === "rate_limited" ? "amber" : "red"}>
                            {r.status}
                          </Badge>
                          {r.error_type ? <span className="ml-1 text-xs text-slate-500">{r.error_type}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {(r.prompt_tokens + r.completion_tokens).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.latency_ms} ms</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.fallback_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
