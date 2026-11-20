// FREE AI API HUB — Playground page.
// Chat through the real gateway (same router/adapters as /v1), streamed
// over SSE. The admin session authenticates — the unified key never enters
// the browser.

import { useEffect, useRef, useState } from "react";
import { modelsApi, playgroundChat, profilesApi, settingsApi, type ChatMessage } from "../lib/api";
import { Badge, Card, EmptyState, Spinner } from "../components/ui";
import type { ModelInfo, RoutingProfile } from "@free-ai-api-hub/shared";

interface Turn {
  role: "user" | "assistant";
  content: string;
  routedVia?: string;
  fallbackCount?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function PlaygroundPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [profiles, setProfiles] = useState<RoutingProfile[]>([]);
  const [storePrompts, setStorePrompts] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, p, s] = await Promise.all([modelsApi.list(), profilesApi.list(), settingsApi.get()]);
        if (cancelled) return;
        setModels(m.models);
        setProfiles(p.profiles);
        setStorePrompts(s.settings.store_prompts === "1");
        const firstAvailable = m.models.find((x) => x.available);
        setSelectedModel(firstAvailable?.model_id ?? m.models[0]?.model_id ?? "");
        const def = p.profiles.find((x) => x.is_default);
        setSelectedProfile(def?.id ?? p.profiles[0]?.id ?? "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the playground");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !selectedModel) return;
    setError(null);
    setInput("");
    const userTurn: Turn = { role: "user", content: text };
    setTurns((prev) => [...prev, userTurn]);
    setStreaming(true);
    const history: ChatMessage[] = [...turns, userTurn].map((t) => ({ role: t.role, content: t.content }));
    // The gateway has no `routing_profile` field — a profile is chosen by
    // sending `model: "auto:<profile-name>"`. A non-default profile wins
    // over the model dropdown; the default profile uses the chosen model.
    const selected = profiles.find((p) => p.id === selectedProfile);
    const modelToSend =
      selected && !selected.is_default && selected.name !== "auto"
        ? `auto:${selected.name}`
        : selectedModel;
    // Append an empty assistant turn and stream into it.
    setTurns((prev) => [...prev, { role: "assistant", content: "" }]);
    try {
      const result = await playgroundChat(history, modelToSend, (delta) => {
        setTurns((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + delta };
          }
          return next;
        });
      });
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: result.content || last.content,
            routedVia: result.routedVia,
            fallbackCount: result.fallbackCount,
            usage: result.usage,
          };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request failed");
      // Drop the empty assistant turn on error.
      setTurns((prev) => prev.filter((t) => t.content !== "" || t.role === "user"));
    } finally {
      setStreaming(false);
    }
  };

  if (loading) return <Spinner label="Loading the playground…" />;
  if (error && models.length === 0) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      </Card>
    );
  }

  const available = models.filter((m) => m.available);
  const selected = models.find((m) => m.model_id === selectedModel);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-4 px-5 py-4">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Model</span>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
          >
            {available.map((m) => (
              <option key={m.id} value={m.model_id}>
                {m.display_name} ({m.provider})
              </option>
            ))}
            {models
              .filter((m) => !m.available)
              .map((m) => (
                <option key={m.id} value={m.model_id} disabled>
                  {m.display_name} ({m.provider}) — unavailable
                </option>
              ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Fallback chain</span>
          <select
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.strategy})
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {selected ? (
            <>
              <Badge tone={selected.available ? "green" : "amber"}>
                {selected.available ? "available" : "unavailable"}
              </Badge>{" "}
              <span className="ml-1">{selected.verified ? "Verified" : "Unverified"}</span>
            </>
          ) : null}
        </div>
      </Card>

      <Card>
        <div ref={scrollRef} className="max-h-[55vh] space-y-4 overflow-y-auto px-5 py-4">
          {turns.length === 0 ? (
            <EmptyState
              title="No messages yet"
              body={
                available.length === 0
                  ? "No model is available yet — add a provider key on the API Keys page, then come back here."
                  : "Send a message to try the selected model through the real gateway. The response streams in, and the header shows which provider actually served it."
              }
            />
          ) : (
            turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    t.role === "user"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800"
                  }`}
                >
                  {t.content || (streaming && i === turns.length - 1 ? "…" : "")}
                  {t.role === "assistant" && t.routedVia ? (
                    <p className="mt-2 border-t border-slate-300 pt-2 text-xs opacity-70 dark:border-slate-700">
                      Routed via {t.routedVia}
                      {t.fallbackCount ? ` · ${t.fallbackCount} fallback${t.fallbackCount > 1 ? "s" : ""}` : ""}
                      {t.usage?.total_tokens ? ` · ${t.usage.total_tokens} tokens` : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Type a message…"
              disabled={streaming || available.length === 0}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={streaming || !input.trim() || available.length === 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {streaming ? "Streaming…" : "Send"}
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Prompt logging is {storePrompts ? "ON (prompts are stored in request logs)" : "OFF (only metadata is logged)"}. Change it in Settings.
          </p>
        </div>
      </Card>
    </div>
  );
}
