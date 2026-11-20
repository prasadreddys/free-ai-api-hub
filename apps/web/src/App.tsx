// FREE AI API HUB — dashboard app shell.
// Auth state (admin session token in sessionStorage) + page routing.

import { useCallback, useEffect, useState } from "react";
import { authApi, setToken } from "./lib/api";
import { Layout, type PageId } from "./components/Layout";
import { DashboardPage } from "./pages/Dashboard";
import { PlaygroundPage } from "./pages/Playground";
import { ModelsPage } from "./pages/Models";
import { KeysPage } from "./pages/Keys";
import { ChainsPage } from "./pages/Chains";
import { AnalyticsPage } from "./pages/Analytics";
import { DocsPage } from "./pages/Docs";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";
import { Spinner } from "./components/ui";

export default function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<PageId>("dashboard");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await authApi.me();
        if (!cancelled) setEmail(me.email);
      } catch {
        // Not signed in (or the token expired) — show the login page.
        if (!cancelled) setEmail(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(() => {
    void authApi.logout().catch(() => undefined);
    setToken(null);
    setEmail(null);
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (!email) {
    return <LoginPage onAuthed={(e) => setEmail(e)} />;
  }

  return (
    <Layout page={page} onNavigate={setPage} email={email} onLogout={logout}>
      {page === "dashboard" && <DashboardPage onNavigate={(p) => setPage(p as PageId)} />}
      {page === "playground" && <PlaygroundPage />}
      {page === "models" && <ModelsPage />}
      {page === "keys" && <KeysPage />}
      {page === "chains" && <ChainsPage />}
      {page === "analytics" && <AnalyticsPage />}
      {page === "docs" && <DocsPage />}
      {page === "settings" && <SettingsPage />}
    </Layout>
  );
}
