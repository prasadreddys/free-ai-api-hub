// FREE AI API HUB — Login / first-run setup page.
// First visit: create the admin account (only works when none exists).
// Afterwards: sign in with email + password.

import { useState } from "react";
import { authApi, setToken } from "../lib/api";
import { Card } from "../components/ui";

export function LoginPage({ onAuthed }: { onAuthed: (email: string) => void }) {
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "setup" && password.length < 12) {
      setError("The admin password must be at least 12 characters.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      const res = mode === "setup" ? await authApi.setup(email, password) : await authApi.login(email, password);
      setToken(res.token);
      onAuthed(res.email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      // If setup says an account already exists, switch to login.
      if (mode === "setup" && msg.toLowerCase().includes("already exists")) {
        setMode("login");
        setError("An admin account already exists — sign in instead.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md px-6 py-8">
        <h1 className="text-xl font-bold tracking-tight">
          FREE AI <span className="text-violet-500">API HUB</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {mode === "setup"
            ? "First run — create the admin account. This only works once."
            : "Sign in to the admin dashboard."}
        </p>
        <div className="mt-6 space-y-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder={mode === "setup" ? "At least 12 characters" : "Your admin password"}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? "Working…" : mode === "setup" ? "Create admin account" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "setup" ? "login" : "setup");
              setError(null);
            }}
            className="w-full text-center text-sm text-violet-600 hover:underline dark:text-violet-400"
          >
            {mode === "setup" ? "I already have an account — sign in" : "First run? Create the admin account"}
          </button>
        </div>
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
          Single-user gateway. The admin password is hashed (PBKDF2) and stored in D1; the session token lives in
          this tab only.
        </p>
      </Card>
    </div>
  );
}
