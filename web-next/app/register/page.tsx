"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { register } from "../lib/api-client";

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = useMemo(() => {
    const value = searchParams?.get("returnUrl") || "/app";
    return value.startsWith("/") ? value : "/app";
  }, [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setIsBusy(true);
    setStatus("Creating account...");
    try {
      await register(email.trim(), password);
      setStatus("Account created. Redirecting...");
      router.replace(returnUrl);
    } catch (err) {
      const statusCode = (err as { status?: number })?.status;
      const message = statusCode === 409
        ? "Email already registered"
        : err instanceof Error
          ? err.message
          : "Registration failed";
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
          "radial-gradient(circle at 20% 20%, rgba(94, 234, 212, 0.16), transparent 45%), radial-gradient(circle at 80% 0%, rgba(14, 116, 144, 0.18), transparent 40%), linear-gradient(160deg, #05070d 0%, #0b151a 50%, #0d1b1f 100%)"
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-14">
        <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-emerald-200">
              Portal Global
            </div>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              Create your operations account.
            </h1>
            <p className="max-w-xl text-base text-slate-300">
              Register once and jump directly into the Autopilot command center with session-based access.
            </p>
            <div className="grid gap-3 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                First admin can bootstrap the tenant.
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-300"></span>
                Passwords require 8+ characters.
              </div>
            </div>
          </div>

          <form
            onSubmit={onSubmit}
            className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_30px_60px_rgba(4,8,15,0.45)]"
          >
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Create account</h2>
              <p className="text-sm text-slate-400">Use a valid email to continue.</p>
            </div>
            <div className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/30"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/30"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm">
                Confirm password
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="Repeat password"
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/30"
                  required
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={isBusy}
              className="mt-6 w-full rounded-xl bg-emerald-300/90 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isBusy ? "Creating..." : "Create account"}
            </button>
            {status ? (
              <p className="mt-4 text-sm text-emerald-200">{status}</p>
            ) : null}
            {error ? (
              <p className="mt-4 text-sm text-rose-300">{error}</p>
            ) : null}
            <p className="mt-6 text-xs text-slate-500">
              Already have an account?{" "}
              <a className="text-emerald-200 hover:text-emerald-100" href="/login">Sign in</a>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-black" />}>
      <RegisterPageContent />
    </Suspense>
  );
}
