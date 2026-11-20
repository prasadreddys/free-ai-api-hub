// FREE AI API HUB — Dashboard page.
// Live stats from the gateway (D1). Empty accounts show honest zeros.

import { useEffect, useState } from "react";
import { analyticsApi, providersApi, type RecentRequest, type TimelinePoint } from "../lib/api";
import { AreaChart } from "../components/Chart";
import { Badge, Card, CardHeader, EmptyState, Spinner, StatCard } from "../components/ui";
import type { ProviderInfo, UsageSummary } from "@free-ai-api-hub/shared";

function statusTone(status: ProviderInfo["status"]) {
  switch (status) {
    case "operational":
      return "green" as const;
    case "degraded":
      return "amber" as const;
    case "not_configured":
      return "slate" as const;
    default:
      return "amber" as const;
  }
}

function shortHour(iso: string): string {
  // "2026-11-19 14:00:00" -> "14:00"
  const parts = iso.split(" ");
  return parts[1]?.slice(0, 5) ?? iso;
}

export function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, t, p, r] = await Promise.all([
          analyticsApi.summary("24h"),
          analyticsApi.timeline("24h"),
          providersApi.list(),
          analyticsApi.recent(8),
        ]);
        if (cancelled) return;
        setSummary(s);
        setTimeline(t.timeline);
        setProviders(p.providers);
        setRecent(r.recent);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner label="Loading the dashboard…" />;
  if (error) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-rose-600 dark:text-rose-400">Failed to load the dashboard: {error}</p>
      </Card>
    );
  }

  const successRate =
    summary && summary.total_requests > 0
      ? Math.round((summary.successful_requests / summary.total_requests) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Requests (24h)" value={String(summary?.total_requests ?? 0)} sub={summary ? `${summary.failed_requests} failed` : undefined} />
        <StatCard
          label="Success rate"
          value={successRate === null ? "—" : `${successRate}%`}
          sub={successRate === null ? "No requests yet" : `${summary?.successful_requests} succeeded`}
        />
        <StatCard label="Tokens (24h)" value={(summary?.total_tokens ?? 0).toLocaleString()} sub={`${(summary?.prompt_tokens ?? 0).toLocaleString()} prompt / ${(summary?.completion_tokens ?? 0).toLocaleString()} completion`} />
        <StatCard label="Avg latency" value={summary ? `${summary.avg_latency_ms} ms` : "—"} sub={summary ? `${summary.fallback_events} fallback events` : undefined} />
      </div>

      <Card>
        <CardHeader title="Requests over time" subtitle="Last 24 hours, hourly buckets. Dashed red = errors." />
        <div className="px-5 py-4">
          {timeline.length === 0 || timeline.every((t) => t.requests === 0) ? (
            <EmptyState
              title="No traffic yet"
              body="Nothing has called the gateway in the last 24 hours. Send a request through the Playground or with your unified key and it will appear here."
              action={
                <button
                  type="button"
                  onClick={() => onNavigate("playground")}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
                >
                  Open the Playground
                </button>
              }
            />
          ) : (
            <AreaChart points={timeline.map((t) => ({ label: shortHour(t.hour), requests: t.requests, errors: t.errors }))} />
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Providers" subtitle="A provider is operational only with a healthy, verified key." />
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {p.last_check_at ? `Last check ${new Date(p.last_check_at).toLocaleString()}` : "Never checked"}
                    {p.last_error ? ` — ${p.last_error}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone(p.status)}>{p.status.replace(/_/g, " ")}</Badge>
              </li>
            ))}
            {providers.length === 0 && (
              <li className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">No providers configured yet.</li>
            )}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Recent requests" subtitle="Latest gateway calls, newest first." />
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
                    <th className="px-3 py-2 text-right font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums">{new Date(r.created_at).toLocaleTimeString()}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.routed_via ?? `${r.provider}/${r.model_id}`}</td>
                      <td className="px-3 py-2">
                        <Badge tone={r.status === "success" ? "green" : r.status === "rate_limited" ? "amber" : "red"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.latency_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
