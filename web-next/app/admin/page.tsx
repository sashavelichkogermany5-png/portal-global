"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import TenantSwitcher from "../components/TenantSwitcher";
import { apiJson, authMe } from "../lib/api-client";

type Overview = {
  users: number;
  tenants: number;
  events: number;
  actions: number;
  messages: number;
  uploads: number;
};

type AdminUser = {
  id: number;
  email: string;
  role: string;
  tenantId: number;
  createdAt: string;
};

type AuditEntry = {
  id: number;
  type: "audit" | "message";
  createdAt: string;
  entity?: string;
  action?: string;
  entityId?: number;
  meta?: unknown;
  sender?: string;
  target?: string;
  role?: string;
  severity?: string;
  message?: string;
  payload?: unknown;
};

const normalizeRole = (value?: string) => {
  if (!value) return "user";
  return value.toLowerCase();
};

const extractRole = (payload: any) => {
  return (
    payload?.data?.role
    || payload?.data?.user?.role
    || payload?.data?.userRole
    || payload?.role
    || payload?.user?.role
    || "user"
  );
};

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);
  const [demoStatus, setDemoStatus] = useState<string>("");
  const [demoBusy, setDemoBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    const payload = await apiJson("/api/admin/overview", { method: "GET" });
    setOverview(payload?.data || null);
  }, []);

  const loadUsers = useCallback(async () => {
    const payload = await apiJson("/api/admin/users", { method: "GET" });
    setUsers(Array.isArray(payload?.data) ? payload.data : []);
  }, []);

  const loadAudit = useCallback(async () => {
    const payload = await apiJson("/api/admin/audit?limit=25", { method: "GET" });
    setAudit(Array.isArray(payload?.data) ? payload.data : []);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadOverview(), loadUsers(), loadAudit()]);
  }, [loadOverview, loadUsers, loadAudit]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      setIsLoading(true);
      setError("");
      try {
        const me = await authMe();
        const role = normalizeRole(extractRole(me));
        if (role !== "admin" && role !== "superadmin") {
          if (active) {
            setIsUnauthorized(true);
          }
          return;
        }
        await loadAll();
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) {
          if (active) {
            setIsUnauthorized(true);
          }
        } else if (active) {
          setError(err instanceof Error ? err.message : "Failed to load admin data");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [loadAll]);

  const onChangeRole = async (user: AdminUser, nextRole: string) => {
    setUpdatingUserId(user.id);
    setError("");
    try {
      await apiJson(`/api/admin/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole })
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleDemoPopulate = async (mode: "minimal" | "full") => {
    setDemoBusy(true);
    setDemoStatus("Populating demo data...");
    setError("");
    try {
      await apiJson("/api/admin/demo/populate", {
        method: "POST",
        body: JSON.stringify({ mode })
      });
      await loadAll();
      setDemoStatus(`Demo data populated (${mode}).`);
    } catch (err) {
      setDemoStatus("");
      setError(err instanceof Error ? err.message : "Failed to populate demo data");
    } finally {
      setDemoBusy(false);
    }
  };

  const handleDemoClear = async () => {
    setDemoBusy(true);
    setDemoStatus("Clearing demo data...");
    setError("");
    try {
      await apiJson("/api/admin/demo/clear", { method: "POST" });
      await loadAll();
      setDemoStatus("Demo data cleared.");
    } catch (err) {
      setDemoStatus("");
      setError(err instanceof Error ? err.message : "Failed to clear demo data");
    } finally {
      setDemoBusy(false);
    }
  };

  const overviewItems = useMemo(() => {
    if (!overview) return [];
    return [
      { label: "Users", value: overview.users },
      { label: "Tenants", value: overview.tenants },
      { label: "Events", value: overview.events },
      { label: "Actions", value: overview.actions },
      { label: "Messages", value: overview.messages },
      { label: "Uploads", value: overview.uploads }
    ];
  }, [overview]);

  if (isUnauthorized) {
    return (
      <main className="min-h-screen bg-black text-slate-100">
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-6 px-6 text-center">
          <h1 className="text-3xl font-semibold">Admin access required</h1>
          <p className="max-w-xl text-sm text-slate-400">
            Your account does not have admin privileges for this tenant. Contact a superadmin or return to the main app.
          </p>
          <Link
            href="/app"
            className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm text-white/90 transition hover:border-white/30"
          >
            Back to app
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">Admin</p>
            <h1 className="text-4xl font-semibold">Tenant control center</h1>
            <p className="max-w-2xl text-sm text-slate-400">
              Review tenant activity, manage member roles, and monitor audit trails from a single control surface.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TenantSwitcher />
            <Link
              href="/app"
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm text-white/90 transition hover:border-white/30"
            >
              Return to app
            </Link>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="mt-10">
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {overviewItems.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_20px_40px_rgba(4,8,15,0.35)]"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{item.label}</p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {isLoading ? "--" : item.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Demo data</h2>
              <p className="text-sm text-slate-400">
                Populate the admin tenant with tagged demo records only.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={demoBusy || isLoading}
                onClick={() => handleDemoPopulate("minimal")}
                className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-300/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Populate minimal
              </button>
              <button
                type="button"
                disabled={demoBusy || isLoading}
                onClick={() => handleDemoPopulate("full")}
                className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-300/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Populate full
              </button>
              <button
                type="button"
                disabled={demoBusy || isLoading}
                onClick={handleDemoClear}
                className="rounded-xl border border-white/10 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 transition hover:border-rose-300/60 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Clear demo
              </button>
            </div>
          </div>
          {demoStatus ? (
            <p className="mt-4 text-sm text-cyan-200">{demoStatus}</p>
          ) : null}
        </section>

        <section className="mt-12">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold">Users</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {users.length} members
            </span>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.2em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-white/10">
                    <td className="px-4 py-3 text-slate-100">{user.email}</td>
                    <td className="px-4 py-3 text-slate-300">{user.role}</td>
                    <td className="px-4 py-3 text-slate-400">{user.tenantId}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {user.createdAt?.split(" ")[0] || "--"}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-100"
                        value={user.role}
                        disabled={updatingUserId === user.id}
                        onChange={(event) => onChangeRole(user, event.target.value)}
                      >
                        <option value="admin">admin</option>
                        <option value="user">user</option>
                      </select>
                    </td>
                  </tr>
                ))}
                {!users.length && !isLoading && (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={5}>
                      No users found for this tenant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold">Audit log</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest activity</span>
          </div>
          <div className="mt-4 grid gap-3">
            {audit.map((entry) => (
              <div
                key={`${entry.type}-${entry.id}`}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">
                    {entry.type}
                  </p>
                  <p className="text-xs text-slate-400">{entry.createdAt}</p>
                </div>
                {entry.type === "audit" ? (
                  <p className="mt-2 text-sm text-slate-200">
                    {entry.entity} В· {entry.action} В· {entry.entityId}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-200">
                    {entry.sender} {"→"} {entry.target || "-"} В· {entry.message}
                  </p>
                )}
              </div>
            ))}
            {!audit.length && !isLoading && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-500">
                No audit entries yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

