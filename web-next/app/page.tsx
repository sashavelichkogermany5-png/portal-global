"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson } from "./lib/api-client";
import { captureEvent } from "./lib/analytics";

type HealthSnapshot = {
  ts?: string;
  uptime?: number;
  env?: string;
};

type PortsSnapshot = {
  backendPort?: number;
  webPort?: number;
  backendUrl?: string;
  webUrl?: string;
  ts?: string;
};

type ApiEnvelope<T> = T & { data?: T };

const unwrapData = <T extends object>(payload: unknown): T => {
  const record = (payload && typeof payload === "object") ? payload as ApiEnvelope<T> : {} as ApiEnvelope<T>;
  if (record.data && typeof record.data === "object") {
    return record.data;
  }
  return record;
};

const formatUptime = (value?: number) => {
  if (!value || Number.isNaN(value)) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}m ${seconds}s`;
};

const formatTimestamp = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

export default function Home() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthStatus, setHealthStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [healthError, setHealthError] = useState("");
  const [ports, setPorts] = useState<PortsSnapshot | null>(null);
  const [portsStatus, setPortsStatus] = useState<"idle" | "loading" | "ready" | "missing" | "error">("idle");
  const [portsError, setPortsError] = useState("");

  useEffect(() => {
    let active = true;

    const loadHealth = async () => {
      setHealthStatus("loading");
      setHealthError("");
      try {
        const payload = await apiJson("/api/health");
        if (!active) return;
        const data = unwrapData<HealthSnapshot>(payload);
        setHealth({
          ts: data?.ts,
          uptime: data?.uptime,
          env: data?.env
        });
        setHealthStatus("ok");
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Health check failed";
        setHealth(null);
        setHealthError(message);
        setHealthStatus("error");
      }
    };

    const loadPorts = async () => {
      setPortsStatus("loading");
      setPortsError("");
      try {
        const response = await fetch("/api/ports", { cache: "no-store" });
        if (!active) return;
        if (!response.ok) {
          if (response.status === 404) {
            setPorts(null);
            setPortsStatus("missing");
            return;
          }
          throw new Error(`ports status ${response.status}`);
        }
        const payload = await response.json();
        const data = unwrapData<PortsSnapshot>(payload);
        setPorts(data);
        setPortsStatus("ready");
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Ports unavailable";
        setPorts(null);
        setPortsError(message);
        setPortsStatus("error");
      }
    };

    loadHealth();
    loadPorts();

    return () => {
      active = false;
    };
  }, []);

  const healthBadge = healthStatus === "loading"
    ? "Checking"
    : healthStatus === "ok"
      ? "Healthy"
      : "Offline";
  const healthBadgeClass = healthStatus === "ok"
    ? "bg-emerald-300/20 text-emerald-200 border-emerald-300/40"
    : healthStatus === "loading"
      ? "bg-sky-300/10 text-sky-200 border-sky-300/30"
      : "bg-rose-300/10 text-rose-200 border-rose-300/30";

  const portsBadge = portsStatus === "ready"
    ? "Detected"
    : portsStatus === "missing"
      ? "Missing"
      : portsStatus === "loading"
        ? "Checking"
        : "Unavailable";
  const portsBadgeClass = portsStatus === "ready"
    ? "bg-amber-200/20 text-amber-200 border-amber-200/40"
    : portsStatus === "loading"
      ? "bg-sky-300/10 text-sky-200 border-sky-300/30"
      : "bg-slate-500/10 text-slate-300 border-slate-500/30";

  return (
    <main
      className="min-h-screen text-slate-100"
      style={{
        fontFamily: '"Space Grotesk", sans-serif',
        background:
          "radial-gradient(circle at 15% 20%, rgba(251, 191, 36, 0.16), transparent 45%), radial-gradient(circle at 85% 15%, rgba(45, 212, 191, 0.18), transparent 40%), linear-gradient(160deg, #05070d 0%, #0b151a 45%, #102126 100%)"
      }}
    >
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12">
        <div className="pointer-events-none absolute -top-24 right-8 h-56 w-56 rounded-full bg-amber-400/20 blur-3xl"></div>
        <div className="pointer-events-none absolute bottom-10 left-10 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl"></div>

        <header className="grid gap-6">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.3em] text-amber-200">
            Portal Global
          </div>
          <div className="grid gap-4">
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              Launch the operations hub for every tenant.
            </h1>
            <p className="max-w-2xl text-base text-slate-300">
              Monitor service health, hop into the Autopilot control panel, and keep platform access aligned across sessions.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/login"
              onClick={() => captureEvent("demo_login_clicked", { source: "landing_login" })}
              className="rounded-xl border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-amber-200/60 hover:bg-white/15"
            >
              Login
            </Link>
            <Link
              href="/login?demo=1"
              onClick={() => captureEvent("demo_login_clicked", { source: "landing_try_demo" })}
              className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-300/15"
            >
              Try demo
            </Link>
            <Link
              href="/app"
              className="rounded-xl bg-amber-200/90 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-amber-100"
            >
              App
            </Link>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_30px_60px_rgba(4,8,15,0.4)]">
            <h2 className="text-2xl font-semibold">What you can do here</h2>
            <p className="mt-3 text-sm text-slate-300">
              Use the portal to authenticate, confirm tenant roles, and keep Autopilot cycles aligned with your team.
            </p>
            <div className="mt-6 grid gap-4 text-sm text-slate-300">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-amber-300"></span>
                Session and Bearer auth stay in sync across UI and API.
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-teal-300"></span>
                Autopilot controls require an active admin tenant role.
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-sky-300"></span>
                Health and port telemetry update in real time.
              </div>
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-cyan-300"></span>
                PostHog captures visits, clicks, forms, and launch events.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_30px_60px_rgba(4,8,15,0.4)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-teal-200">Status</p>
                <h2 className="text-2xl font-semibold">System snapshot</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-200">
                Live
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-300">Health</p>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${healthBadgeClass}`}>
                    {healthBadge}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Env: {health?.env || "-"} · Uptime: {formatUptime(health?.uptime)} · Updated: {formatTimestamp(health?.ts)}
                </div>
                {healthStatus === "error" ? (
                  <p className="mt-2 text-xs text-rose-300">{healthError}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-300">Ports</p>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${portsBadgeClass}`}>
                    {portsBadge}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Backend: {ports?.backendPort ?? "-"} · Web: {ports?.webPort ?? "-"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Updated: {formatTimestamp(ports?.ts)}
                </div>
                {portsStatus === "error" ? (
                  <p className="mt-2 text-xs text-rose-300">{portsError}</p>
                ) : null}
                {portsStatus === "missing" ? (
                  <p className="mt-2 text-xs text-slate-400">ports.json not found.</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
