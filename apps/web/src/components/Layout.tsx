// FREE AI API HUB — dashboard shell: sidebar nav + header with theme toggle.

import { useEffect, useState, type ReactNode } from "react";

export type PageId =
  | "dashboard"
  | "playground"
  | "models"
  | "keys"
  | "chains"
  | "analytics"
  | "docs"
  | "settings";

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "playground", label: "Playground", icon: "▶" },
  { id: "models", label: "Models", icon: "◇" },
  { id: "keys", label: "API Keys", icon: "⚿" },
  { id: "chains", label: "Fallback Chains", icon: "⇄" },
  { id: "analytics", label: "Analytics", icon: "∿" },
  { id: "docs", label: "API Docs", icon: "≡" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

const PAGE_TITLES: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Your gateway at a glance — live usage from D1, nothing fabricated." },
  playground: { title: "Playground", subtitle: "Try models through the real gateway. Runs the same router as /v1." },
  models: { title: "Models", subtitle: "Every model in the catalog, with honest availability and verification state." },
  keys: { title: "API Keys", subtitle: "Provider keys (encrypted at rest) and the unified gateway keys your apps use." },
  chains: { title: "Fallback Chains", subtitle: "Routing profiles: which models to try, in which order, on failure." },
  analytics: { title: "Analytics", subtitle: "Requests, tokens, latency and errors — real rows only, honest zeros." },
  docs: { title: "API Docs", subtitle: "One unified key, one endpoint. OpenAI-compatible." },
  settings: { title: "Settings", subtitle: "Logging, retention, rate limits, and config export." },
};

export function Layout({
  page,
  onNavigate,
  email,
  onLogout,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  email: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem("fai_theme");
    if (stored) return stored === "dark";
    return true; // dark by default
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("fai_theme", dark ? "dark" : "light");
  }, [dark]);

  const { title, subtitle } = PAGE_TITLES[page];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0d1220] md:flex">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <p className="text-lg font-bold tracking-tight">
            FREE AI <span className="text-violet-500">API HUB</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            One key. Every free model.
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                page === item.id
                  ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <span className="w-5 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <p className="truncate" title={email}>
            Signed in as {email}
          </p>
          <button type="button" onClick={onLogout} className="mt-1 font-medium text-rose-600 hover:underline dark:text-rose-400">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-[#0a0e1a]/80">
          <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-8">
            <div>
              <h1 className="text-lg font-bold leading-tight">{title}</h1>
              <p className="hidden text-sm text-slate-500 dark:text-slate-400 sm:block">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Mobile nav */}
              <select
                value={page}
                onChange={(e) => onNavigate(e.target.value as PageId)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 md:hidden"
                aria-label="Navigate"
              >
                {NAV.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setDark(!dark)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {dark ? "☀ Light" : "◐ Dark"}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">{children}</main>
        <footer className="border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400 md:px-8">
          FREE AI API HUB v1 — free-tier only. Provider keys are encrypted at rest; usage shows real rows only.
        </footer>
      </div>
    </div>
  );
}
