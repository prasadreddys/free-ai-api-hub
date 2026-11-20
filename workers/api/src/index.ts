// FREE AI API HUB — Workers gateway entrypoint.
// Routes /v1/* (unified-key auth, OpenAI-compatible) and /api/* (admin).
// CORS is open (*) because auth is a Bearer token, not a cookie.
// Original code for this project.

import type { Env } from "./env";
import { ApiError, toErrorResponse } from "./lib/errors";
import { handleHealth } from "./routes/health";
import { handleChatCompletion, handlePlaygroundChat } from "./routes/chat";
import { handleAdminListModels, handleAdminUpdateModel, handleListModels } from "./routes/models";
import { handleAdminAnalyticsSummary, handleAdminAnalyticsTimeline, handleAdminRecent, handleUsage } from "./routes/usage";
import { handleAdminListProviders, handleListProviders } from "./routes/providers";
import {
  handleAddProviderKey,
  handleAdminListKeys,
  handleAdminTestKey,
  handleAdminUpdateKey,
  handleDeleteProviderKey,
} from "./routes/keys";
import {
  handleCreateUnifiedKey,
  handleListUnifiedKeys,
  handleRevokeUnifiedKey,
  handleRotateUnifiedKey,
} from "./routes/unified-keys";
import { handleTest } from "./routes/test";
import {
  handleCreateProfile,
  handleDeleteProfile,
  handleExport,
  handleGetSettings,
  handleListProfiles,
  handleLogin,
  handleLogout,
  handleMe,
  handleSetup,
  handleUpdateProfile,
  handleUpdateSettings,
} from "./routes/admin";
import { handleScheduled } from "./cron";

type Handler = (
  env: Env,
  request: Request,
  params: Record<string, string>,
  ctx: ExecutionContext,
) => Promise<Response>;

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
}

const ROUTES: Route[] = [
  { method: "GET", pattern: "/v1/health", handler: (env) => handleHealth(env) },
  { method: "POST", pattern: "/v1/chat/completions", handler: (env, req, _p, ctx) => handleChatCompletion(env, req, ctx) },
  { method: "GET", pattern: "/v1/models", handler: (env, req) => handleListModels(env, req) },
  { method: "GET", pattern: "/v1/usage", handler: (env, req) => handleUsage(env, req) },
  { method: "GET", pattern: "/v1/providers", handler: (env, req) => handleListProviders(env, req) },
  { method: "POST", pattern: "/v1/test", handler: (env, req) => handleTest(env, req) },
  { method: "POST", pattern: "/v1/keys", handler: (env, req) => handleAddProviderKey(env, req) },
  { method: "DELETE", pattern: "/v1/keys/:id", handler: (env, req, p) => handleDeleteProviderKey(env, req, p.id) },
  { method: "POST", pattern: "/api/playground/chat", handler: (env, req, _p, ctx) => handlePlaygroundChat(env, req, ctx) },
  { method: "GET", pattern: "/api/models", handler: (env, req) => handleAdminListModels(env, req) },
  { method: "PATCH", pattern: "/api/models/:id", handler: (env, req, p) => handleAdminUpdateModel(env, req, p.id) },
  { method: "GET", pattern: "/api/analytics/summary", handler: (env, req) => handleAdminAnalyticsSummary(env, req) },
  { method: "GET", pattern: "/api/analytics/timeline", handler: (env, req) => handleAdminAnalyticsTimeline(env, req) },
  { method: "GET", pattern: "/api/analytics/recent", handler: (env, req) => handleAdminRecent(env, req) },
  { method: "GET", pattern: "/api/providers", handler: (env, req) => handleAdminListProviders(env, req) },
  { method: "GET", pattern: "/api/keys", handler: (env, req) => handleAdminListKeys(env, req) },
  { method: "PATCH", pattern: "/api/keys/:id", handler: (env, req, p) => handleAdminUpdateKey(env, req, p.id) },
  { method: "POST", pattern: "/api/keys/:id/test", handler: (env, req, p) => handleAdminTestKey(env, req, p.id) },
  { method: "POST", pattern: "/api/unified-keys", handler: (env, req) => handleCreateUnifiedKey(env, req) },
  { method: "GET", pattern: "/api/unified-keys", handler: (env, req) => handleListUnifiedKeys(env, req) },
  { method: "DELETE", pattern: "/api/unified-keys/:id", handler: (env, req, p) => handleRevokeUnifiedKey(env, req, p.id) },
  { method: "POST", pattern: "/api/unified-keys/:id/rotate", handler: (env, req, p) => handleRotateUnifiedKey(env, req, p.id) },
  { method: "POST", pattern: "/api/auth/setup", handler: (env, req) => handleSetup(env, req) },
  { method: "POST", pattern: "/api/auth/login", handler: (env, req) => handleLogin(env, req) },
  { method: "POST", pattern: "/api/auth/logout", handler: (env, req) => handleLogout(env, req) },
  { method: "GET", pattern: "/api/auth/me", handler: (env, req) => handleMe(env, req) },
  { method: "GET", pattern: "/api/profiles", handler: (env, req) => handleListProfiles(env, req) },
  { method: "POST", pattern: "/api/profiles", handler: (env, req) => handleCreateProfile(env, req) },
  { method: "PUT", pattern: "/api/profiles/:id", handler: (env, req, p) => handleUpdateProfile(env, req, p.id) },
  { method: "DELETE", pattern: "/api/profiles/:id", handler: (env, req, p) => handleDeleteProfile(env, req, p.id) },
  { method: "GET", pattern: "/api/settings", handler: (env, req) => handleGetSettings(env, req) },
  { method: "PATCH", pattern: "/api/settings", handler: (env, req) => handleUpdateSettings(env, req) },
  { method: "GET", pattern: "/api/export", handler: (env, req) => handleExport(env, req) },
];

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const pathParts = path.split("/").filter((s) => s !== "");
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const patternParts = route.pattern.split("/").filter((s) => s !== "");
    if (patternParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];
      if (pp.startsWith(":")) {
        params[pp.slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (pp !== pathParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-admin-token, x-unified-key",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

async function handleFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Preflight.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const cors = corsHeaders(request);
  try {
    const matched = matchRoute(request.method, path);
    if (!matched) {
      throw new ApiError(404, "not_found_error", `No route for ${request.method} ${path}`);
    }
    const res = await matched.route.handler(env, request, matched.params, ctx);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    const res = err instanceof ApiError ? toErrorResponse(err) : toErrorResponse(new ApiError(500, "server_error", "Internal server error"));
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env, event.cron));
  },
};
