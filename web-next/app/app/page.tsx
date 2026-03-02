"use client";

import { useEffect, useState } from "react";
import {
  apiJson,
  authMe,
  clearAuth,
  getStoredTenantId,
  setStoredTenantId
} from "../lib/api-client";

type HealthSnapshot = {
  ts?: string;
  uptime?: number;
  env?: string;
};

type AutopilotSnapshot = {
  tenantId?: number | string | null;
  enabled?: boolean;
  mode?: string;
  intervalMin?: number;
  paymentMode?: string;
  lastRunAt?: string | null;
  lastCorrelationId?: string | null;
};

type AuthData = {
  communityMode?: boolean;
  autopilotEnabled?: boolean;
  isGuest?: boolean;
  activeTenantId?: number | string | null;
  tenantRole?: string;
  user?: { role?: string };
};

export default function AppPage() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(getStoredTenantId());
  const [tenantRole, setTenantRole] = useState<string | null>(null);
  const [autopilot, setAutopilot] = useState<AutopilotSnapshot | null>(null);
  const [autopilotAvailable, setAutopilotAvailable] = useState(true);
  const [authState, setAuthState] = useState<"unknown" | "authenticated" | "guest">("unknown");
  const [communityMode, setCommunityMode] = useState(false);
  const [autopilotEnabled, setAutopilotEnabled] = useState(true);
  const [pageStatus, setPageStatus] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);

  const refreshHealth = async () => {
    const payload = await apiJson("/api/health");
    const data = payload?.data || payload;
    setHealth({
      ts: data?.ts,
      uptime: data?.uptime,
      env: data?.env
    });
  };

  const refreshSession = async () => {
    try {
      const payload = await authMe();
      const data = payload?.data || payload as AuthData;
      const activeTenantId = data?.activeTenantId || null;
      const roleValue = data?.tenantRole || data?.user?.role || null;
      const isCommunity = data?.communityMode || false;
      const isAutopilotEnabled = data?.autopilotEnabled !== false;
      const isGuest = data?.isGuest === true || !data?.userId;
      
      setCommunityMode(isCommunity);
      setAutopilotEnabled(isAutopilotEnabled);
      
      if (activeTenantId) {
        setTenantId(String(activeTenantId));
        setStoredTenantId(activeTenantId);
      }
      setTenantRole(roleValue ? String(roleValue) : null);
      setAuthState(isGuest && isCommunity ? "guest" : "authenticated");
      return !isGuest || isCommunity;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        clearAuth();
        setTenantId(null);
        setTenantRole(null);
        setAuthState("guest");
        setCommunityMode(true);
        return false;
      }
      throw err;
    }
  };

  const refreshAutopilot = async () => {
    try {
      const payload = await apiJson("/api/autopilot/status");
      const data = payload?.data || payload;
      setAutopilotAvailable(true);
      setAutopilot({
        tenantId: data?.tenantId,
        enabled: data?.enabled,
        mode: data?.mode,
        intervalMin: data?.intervalMin,
        paymentMode: data?.paymentMode,
        lastRunAt: data?.lastRunAt,
        lastCorrelationId: data?.lastCorrelationId
      });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        setAutopilotAvailable(false);
        setAutopilot(null);
        return;
      }
      throw err;
    }
  };

  const loadAll = async () => {
    setIsLoading(true);
    setPageStatus("");
    try {
      await refreshHealth();
      const hasSession = await refreshSession();
      if (hasSession) {
        await refreshAutopilot();
      } else {
        setAutopilot(null);
        setAutopilotAvailable(true);
        setActionStatus("");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load data";
      setPageStatus(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll().catch(() => {});
  }, []);

  const handleEnable = async () => {
    setIsWorking(true);
    setActionStatus("Enabling Autopilot...");
    try {
      await apiJson("/api/autopilot/enable", {
        method: "POST",
        body: JSON.stringify({ enabled: true })
      });
      await refreshAutopilot();
      setActionStatus("Autopilot enabled.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Enable failed";
      setActionStatus(message);
    } finally {
      setIsWorking(false);
    }
  };

  const handleTick = async () => {
    setIsWorking(true);
    setActionStatus("Running Autopilot tick...");
    try {
      await apiJson("/api/autopilot/tick", {
        method: "POST",
        body: JSON.stringify({})
      });
      await refreshAutopilot();
      setActionStatus("Autopilot tick started.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tick failed";
      setActionStatus(message);
    } finally {
      setIsWorking(false);
    }
  };

  const formatUptime = (value?: number) => {
    if (!value || Number.isNaN(value)) return "-";
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}m ${seconds}s`;
  };

  const isAuthenticated = authState === "authenticated";
  const normalizedRole = (tenantRole || "").toLowerCase();
  const isAdmin = normalizedRole === "admin" || normalizedRole === "superadmin";
  const canControlAutopilot = isAuthenticated && autopilotAvailable && isAdmin && autopilotEnabled;
  const autopilotLabel = !autopilotEnabled
    ? "Disabled by admin"
    : !autopilotAvailable
    ? "Not available"
    : isAuthenticated
      ? isAdmin
        ? autopilot?.enabled
          ? "Enabled"
          : "Disabled"
        : "Admin required"
      : "Auth required";

  return (
    <main
      className="min-h-screen text-slate-100"
      style={{
        fontFamily: '"Space Grotesk", sans-serif',
        background:
          "radial-gradient(circle at 15% 15%, rgba(56, 189, 248, 0.16), transparent 45%), radial-gradient(circle at 85% 10%, rgba(59, 130, 246, 0.16), transparent 40%), linear-gradient(160deg, #05070d 0%, #0b151a 45%, #0a2026 100%)"
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_30px_60px_rgba(4,8,15,0.4)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">Portal Global</p>
              <h1 className="text-3xl font-semibold">Autopilot Ops Panel</h1>
            </div>
            <button
              type="button"
              onClick={loadAll}
              className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100"
              disabled={isLoading}
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <p className="text-sm text-slate-300">
            Live snapshot of health, tenant context, and Autopilot runtime. All requests include session cookies and optional Bearer token.
          </p>
          {pageStatus ? (
            <p className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
              {pageStatus}
            </p>
          ) : null}
        </header>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-sm uppercase tracking-[0.2em] text-slate-400">Health</h2>
            <p className="mt-3 text-2xl font-semibold text-emerald-200">
              {health ? "OK" : isLoading ? "Loading" : "Unavailable"}
            </p>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Env</span>
                <span className="text-slate-100">{health?.env || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Uptime</span>
                <span className="text-slate-100">{formatUptime(health?.uptime)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last check</span>
                <span className="text-slate-100">{health?.ts || "-"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-sm uppercase tracking-[0.2em] text-slate-400">Tenant</h2>
            <p className="mt-3 text-2xl font-semibold text-cyan-200">
              {tenantId || "Unknown"}
            </p>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Session</span>
                <span className="text-slate-100">{tenantId ? "Active" : "Missing"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Role</span>
                <span className="text-slate-100">{tenantRole || (isAuthenticated ? "Member" : "Guest")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Auth</span>
                <span className="text-slate-100">Cookie + Bearer</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-sm uppercase tracking-[0.2em] text-slate-400">Autopilot</h2>
            <p className="mt-3 text-2xl font-semibold text-amber-200">
              {autopilotLabel}
            </p>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Mode</span>
                <span className="text-slate-100">{autopilot?.mode || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Interval</span>
                <span className="text-slate-100">
                  {autopilot?.intervalMin ? `${autopilot.intervalMin} min` : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last run</span>
                <span className="text-slate-100">{autopilot?.lastRunAt || "-"}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Autopilot controls</h2>
              <p className="text-sm text-slate-400">Enable and run a manual tick with session cookies.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleEnable}
                disabled={!canControlAutopilot || isWorking}
                className="rounded-xl bg-emerald-300/90 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Enable Autopilot
              </button>
              <button
                type="button"
                onClick={handleTick}
                disabled={!canControlAutopilot || isWorking}
                className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Run Tick
              </button>
            </div>
          </div>
          {!isAuthenticated ? (
            <p className="mt-4 text-sm text-amber-200">Auth required to manage Autopilot.</p>
          ) : !isAdmin ? (
            <p className="mt-4 text-sm text-amber-200">Admin required to manage Autopilot.</p>
          ) : actionStatus ? (
            <p className="mt-4 text-sm text-cyan-200">{actionStatus}</p>
          ) : null}
        </section>

        {!isAdmin && isAuthenticated ? (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Client data</h2>
                <p className="text-sm text-slate-400">
                  No data yet. Connect a data source to start collecting activity.
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300">
                Empty state
              </span>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
