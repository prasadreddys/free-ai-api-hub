// FREE AI API HUB — GET /v1/health.
// Public liveness probe: never requires auth, never leaks internals.
// Original code for this project.

import type { Env } from "../env";

export async function handleHealth(env: Env): Promise<Response> {
  let db: "ok" | "error" = "ok";
  let kv: "ok" | "error" = "ok";
  try {
    await env.DB.prepare("SELECT 1 AS one").first();
  } catch {
    db = "error";
  }
  try {
    // A get on a never-written key proves the binding is reachable.
    await env.KV.get("health:probe");
  } catch {
    kv = "error";
  }
  const ok = db === "ok" && kv === "ok";
  return new Response(
    JSON.stringify({
      ok,
      version: "1.0.0",
      db,
      kv,
      timestamp: new Date().toISOString(),
    }),
    {
      status: ok ? 200 : 503,
      headers: { "content-type": "application/json" },
    },
  );
}
