// FREE AI API HUB — API Docs page.
// The unified gateway is OpenAI-compatible: one key, one endpoint.

import { useState } from "react";
import { Card, CardHeader, CopyButton } from "../components/ui";

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) || "https://<your-worker>.workers.dev";

function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between rounded-t-lg bg-slate-800 px-4 py-2 text-xs text-slate-300">
        <span>{language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="rounded-b-lg rounded-t-none">{code}</pre>
    </div>
  );
}

export function DocsPage() {
  const [key, setKey] = useState("");
  const shownKey = key.trim() || "fai_live_your_unified_key_here";

  const curl = `curl ${BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer ${shownKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{ "role": "user", "content": "Hello!" }],
    "stream": false
  }'`;

  const python = `import requests

resp = requests.post(
    "${BASE_URL}/v1/chat/completions",
    headers={
        "Authorization": "Bearer ${shownKey}",
        "Content-Type": "application/json",
    },
    json={
        "model": "gemini-2.5-flash",
        "messages": [{"role": "user", "content": "Hello!"}],
        "stream": False,
    },
    timeout=60,
)
resp.raise_for_status()
print(resp.json()["choices"][0]["message"]["content"])`;

  const openai = `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}/v1",
    api_key="${shownKey}",
)

resp = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)`;

  const js = `const resp = await fetch("${BASE_URL}/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer ${shownKey}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "Hello!" }],
    stream: false,
  }),
});
const data = await resp.json();
console.log(data.choices[0].message.content);`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Getting started"
          subtitle="Create a unified key on the API Keys page, then point any OpenAI-compatible client at the gateway."
        />
        <div className="space-y-4 px-5 py-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Your unified key (optional — fills the examples below; never sent anywhere)</span>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="fai_live_…"
              autoComplete="off"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>Add a free-tier provider key on the API Keys page (it is validated live before it is stored).</li>
            <li>Create a unified gateway key on the same page.</li>
            <li>Send requests to <code>{BASE_URL}/v1/chat/completions</code> with that key.</li>
            <li>The gateway routes the request to the best available provider and answers with <code>X-Routed-Via</code>.</li>
          </ol>
        </div>
      </Card>

      <Card>
        <CardHeader title="Endpoints" subtitle="OpenAI-compatible shapes. Errors use the OpenAI error envelope." />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-5 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Path</th>
                <th className="px-3 py-2 font-medium">Auth</th>
                <th className="px-3 py-2 font-medium">What it does</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["POST", "/v1/chat/completions", "Unified key", "Chat completion (streaming supported). The core endpoint."],
                ["GET", "/v1/models", "Unified key", "List models with availability and verification state."],
                ["GET", "/v1/providers", "Unified key", "Provider status — operational only with a healthy, verified key."],
                ["GET", "/v1/usage?window=24h|7d|30d", "Unified key", "Usage for the calling key. Real rows only."],
                ["POST", "/v1/test", "Unified key", "Test a key/model without storing anything (10/min)."],
                ["POST", "/v1/keys", "Admin", "Add a provider key (live-validated first)."],
                ["DELETE", "/v1/keys/:id", "Admin", "Remove a provider key."],
                ["GET", "/v1/health", "None", "Liveness probe (DB + KV)."],
              ].map(([method, path, auth, what]) => (
                <tr key={path} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-5 py-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-800">{method}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{path}</td>
                  <td className="px-3 py-2">{auth}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Request and response" subtitle="The chat endpoint accepts the OpenAI chat shape." />
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-slate-600 dark:text-slate-300">
            Required: <code>model</code> (a model id from <code>GET /v1/models</code>,{" "}
            <code>provider/model-id</code>, or <code>auto</code> / <code>auto:&lt;profile&gt;</code>{" "}
            to let the gateway pick from a routing profile) and <code>messages</code> (an array of{" "}
            <code>role</code>/<code>content</code>). Optional: <code>temperature</code> (0–2),{" "}
            <code>max_tokens</code>, <code>top_p</code>, <code>stop</code>, <code>stream</code> (default false).
          </p>
          <p className="text-slate-600 dark:text-slate-300">
            Responses are OpenAI-shaped (<code>choices[0].message.content</code>). Every response carries{" "}
            <code>X-Routed-Via: provider/model</code> naming the provider that actually served it, and{" "}
            <code>X-Fallback-Count</code> when a fallback happened. Token counts are the upstream's real counts;
            Workers AI reports zero (it does not return usage).
          </p>
          <p className="text-slate-600 dark:text-slate-300">
            Errors: <code>{"{ error: { message, type, code } }"}</code> with HTTP 400 (bad request), 401 (bad or
            revoked key), 429 (rate limit — Retry-After is set), 502/503 (all providers failed — the message says
            why), 504 (timeout).
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Examples" subtitle="Copy, paste, run." />
        <div className="space-y-6 px-5 py-4">
          <CodeBlock code={curl} language="cURL" />
          <CodeBlock code={python} language="Python (requests)" />
          <CodeBlock code={openai} language="Python (OpenAI SDK)" />
          <CodeBlock code={js} language="JavaScript (fetch)" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Limits" subtitle="What the free tier allows, and what the gateway enforces." />
        <div className="space-y-2 px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
          <p>• Default rate limit: 120 requests/minute per unified key (change it in Settings). A per-key daily limit can be set when the key is created.</p>
          <p>• Fallback: at most 5 attempts per request. A key that is rate-limited, out of quota, or erroring is cooled down and skipped (5 min for rate limits, 1 min for other errors, 15 min for quota exhaustion).</p>
          <p>• Streaming: SSE, OpenAI chunk shape, ending with <code>data: [DONE]</code>.</p>
          <p>• Body limit: 1 MB per request. Timeouts: the upstream call is capped at 60 s; the whole request at 90 s.</p>
          <p>• Prompt logging is OFF by default. When it is on, prompts are stored in request logs and pruned after the retention window (default 30 days).</p>
        </div>
      </Card>
    </div>
  );
}
