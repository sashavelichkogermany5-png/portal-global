"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authMe, login } from "../lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = useMemo(() => {
    const value = searchParams.get("returnUrl") || "/app";
    return value.startsWith("/") ? value : "/app";
  }, [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let active = true;
    authMe()
      .then(() => {
        if (active) {
          router.replace(returnUrl);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [router, returnUrl]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setStatus("Signing in...");
    setError("");
    try {
      await login(email.trim(), password);
      setStatus("Signed in. Redirecting...");
      router.replace(returnUrl);
    } catch (err) {
      const statusCode = (err as { status?: number })?.status;
      const message = statusCode === 404
        ? "Auth endpoint missing"
        : err instanceof Error
          ? err.message
          : "Login failed";
      setError(message);
      setStatus("");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main
      className="min-h-screen text-slate-100"
      style={{
        fontFamily: '"Space Grotesk", sans-serif',
        background:
          "radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.18), transparent 45%), radial-gradient(circle at 80% 0%, rgba(34, 211, 238, 0.16), transparent 40%), linear-gradient(160deg, #05070d 0%, #0b151a 50%, #0d1b1f 100%)"
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-14">
        <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-200">
              Portal Global
            </div>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              Sign in to your operations command center.
            </h1>
            <p className="max-w-xl text-base text-slate-300">
              Session-based access keeps the UI and API in lockstep. Sign in to view tenant health and control Autopilot cycles.
            </p>
            <div className="grid gap-3 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                Cookies plus optional Bearer token are supported.
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-300"></span>
                Auto-redirects to /app after login.
              </div>
            </div>
          </div>

          <form
            onSubmit={onSubmit}
            className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_30px_60px_rgba(4,8,15,0.45)]"
          >
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Welcome back</h2>
              <p className="text-sm text-slate-400">Use your portal credentials to continue.</p>
            </div>
            <div className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/30"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your password"
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/30"
                  required
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={isBusy}
              className="mt-6 w-full rounded-xl bg-cyan-300/90 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isBusy ? "Signing in..." : "Sign in"}
            </button>
            {status ? (
              <p className="mt-4 text-sm text-cyan-200">{status}</p>
            ) : null}
            {error ? (
              <p className="mt-4 text-sm text-rose-300">{error}</p>
            ) : null}
            <p className="mt-2 text-xs text-slate-500">
              New here?{" "}
              <a className="text-cyan-200 hover:text-cyan-100" href="/register">Create an account</a>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
