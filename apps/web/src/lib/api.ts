// FREE AI API HUB — frontend API client.
// Talks to the Workers gateway. The Worker URL comes from VITE_API_URL
// (set at Pages build time); empty means same-origin (local dev proxy).
// The admin token is kept in sessionStorage (cleared when the tab closes)
// and sent as a Bearer header — never in a cookie, never in the URL.

import type {
  ModelInfo,
  ProviderInfo,
  ProviderKeyInfo,
  RoutingProfile,
  UnifiedKeyInfo,
  UsageSummary,
} from "@free-ai-api-hub/shared";

const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface ApiErrorShape {
  message: string;
  status: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem("fai_admin_token");
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem("fai_admin_token", token);
  else sessionStorage.removeItem("fai_admin_token");
}

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const token = opts.token ?? getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      (data as { message?: string } | null)?.message ??
      `Request failed (HTTP ${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

// --- Auth ---
export interface AuthResult {
  ok: boolean;
  email: string;
  token: string;
}

export const authApi = {
  setup: (email: string, password: string) =>
    apiFetch<AuthResult>("/api/auth/setup", { method: "POST", body: { email, password } }),
  login: (email: string, password: string) =>
    apiFetch<AuthResult>("/api/auth/login", { method: "POST", body: { email, password } }),
  logout: () => apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => apiFetch<{ ok: boolean; email: string }>("/api/auth/me"),
};

// --- Models / providers ---
export const modelsApi = {
  list: () => apiFetch<{ models: ModelInfo[] }>("/api/models"),
  setEnabled: (id: string, enabled: boolean) =>
    apiFetch<{ ok: boolean }>(`/api/models/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { enabled },
    }),
};

export const providersApi = {
  list: () => apiFetch<{ providers: ProviderInfo[] }>("/api/providers"),
};

// --- Provider keys ---
export interface AddProviderKeyInput {
  provider: string;
  key: string;
  label?: string;
  priority?: number;
  base_url?: string;
  model_id?: string;
}

export const keysApi = {
  list: () => apiFetch<{ keys: ProviderKeyInfo[] }>("/api/keys"),
  add: (input: AddProviderKeyInput) =>
    apiFetch<{ key: ProviderKeyInfo }>("/v1/keys", { method: "POST", body: input }),
  remove: (id: string) =>
    apiFetch<{ ok: boolean }>(`/v1/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  update: (id: string, patch: { label?: string; priority?: number; enabled?: boolean }) =>
    apiFetch<{ key: ProviderKeyInfo }>(`/api/keys/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    }),
  test: (id: string) =>
    apiFetch<{ valid: boolean; error?: string | null }>(`/api/keys/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }),
};

// --- Unified keys ---
export const unifiedKeysApi = {
  list: () => apiFetch<{ keys: UnifiedKeyInfo[] }>("/api/unified-keys"),
  create: (name: string, daily_limit?: number | null) =>
    apiFetch<{ key: string; info: UnifiedKeyInfo }>("/api/unified-keys", {
      method: "POST",
      body: { name, daily_limit: daily_limit ?? null },
    }),
  revoke: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/unified-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  rotate: (id: string) =>
    apiFetch<{ key: string; info: UnifiedKeyInfo }>(`/api/unified-keys/${encodeURIComponent(id)}/rotate`, {
      method: "POST",
    }),
};

// --- Profiles (fallback chains) ---
export const profilesApi = {
  list: () => apiFetch<{ profiles: RoutingProfile[] }>("/api/profiles"),
  create: (profile: Omit<RoutingProfile, "id">) =>
    apiFetch<{ ok: boolean; id: string }>("/api/profiles", { method: "POST", body: profile }),
  update: (id: string, profile: Omit<RoutingProfile, "id">) =>
    apiFetch<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: profile,
    }),
  remove: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// --- Analytics ---
export interface TimelinePoint {
  hour: string;
  requests: number;
  errors: number;
  tokens_in: number;
  tokens_out: number;
}

export interface RecentRequest {
  id: string;
  created_at: string;
  provider: string;
  model_id: string;
  status: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  routed_via: string | null;
  fallback_count: number;
  error_type: string | null;
}

export const analyticsApi = {
  summary: (window: string) =>
    apiFetch<UsageSummary>(`/api/analytics/summary?window=${encodeURIComponent(window)}`),
  timeline: (window: string) =>
    apiFetch<{ timeline: TimelinePoint[] }>(
      `/api/analytics/timeline?window=${encodeURIComponent(window)}`,
    ),
  recent: (limit = 20) =>
    apiFetch<{ recent: RecentRequest[] }>(`/api/analytics/recent?limit=${limit}`),
};

// --- Settings / export ---
export const settingsApi = {
  get: () => apiFetch<{ settings: Record<string, string | null> }>("/api/settings"),
  update: (settings: Record<string, string>) =>
    apiFetch<{ ok: boolean }>("/api/settings", { method: "PATCH", body: settings }),
  exportUrl: () => `${API_BASE}/api/export`,
};

// --- Playground ---
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface PlaygroundResult {
  content: string;
  routedVia: string;
  fallbackCount: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Send a playground chat (streaming). Calls onDelta for each text chunk. */
export async function playgroundChat(
  messages: ChatMessage[],
  model: string,
  onDelta: (text: string) => void,
): Promise<PlaygroundResult> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/playground/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });
  if (!res.ok) {
    let msg = `Request failed (HTTP ${res.status})`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      if (data.error?.message) msg = data.error.message;
    } catch {
      // keep default
    }
    throw new ApiError(msg, res.status);
  }
  const routedVia = res.headers.get("x-routed-via") ?? "";
  const fallbackCount = Number.parseInt(res.headers.get("x-fallback-count") ?? "0", 10) || 0;
  const reader = res.body?.getReader();
  if (!reader) throw new ApiError("Streaming is not supported by this browser", 0);
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: PlaygroundResult["usage"];
  const sseLines: string[] = [];
  const processLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return;
    try {
      const chunk = JSON.parse(payload) as {
        choices?: { delta?: { content?: string }; message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
      if (delta) {
        content += delta;
        onDelta(delta);
      }
      if (chunk.usage) usage = chunk.usage;
    } catch {
      // ignore malformed SSE lines
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) sseLines.push(trimmed);
      processLine(trimmed);
    }
  }
  if (buffer.trim()) processLine(buffer.trim());
  return { content, routedVia, fallbackCount, usage };
}
