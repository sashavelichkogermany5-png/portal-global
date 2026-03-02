"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson, authMe, setStoredTenantId } from "../lib/api-client";

type Membership = {
  tenantId: number;
  tenantName?: string;
  role?: string;
  status?: string;
};

type TenantsPayload = {
  memberships?: Membership[];
  activeTenantId?: number | null;
};

const normalizeRole = (value?: string) => {
  if (!value) return "user";
  return value.toLowerCase();
};

const extractRole = (payload: any) => (
  payload?.data?.role
  || payload?.data?.user?.role
  || payload?.data?.userRole
  || payload?.role
  || payload?.user?.role
  || "user"
);

export default function TenantSwitcher() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const loadTenants = useCallback(async () => {
    const payload = await apiJson("/api/tenants", { method: "GET" });
    const data: TenantsPayload = payload?.data || payload || {};
    const nextMemberships = Array.isArray(data.memberships) ? data.memberships : [];
    setMemberships(nextMemberships);
    const nextActive = data.activeTenantId ? Number(data.activeTenantId) : null;
    setActiveTenantId(Number.isFinite(nextActive as number) ? nextActive : null);
    if (nextActive) {
      setStoredTenantId(nextActive);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const me = await authMe();
        const role = normalizeRole(extractRole(me));
        if (!active || role === "guest") {
          return;
        }
        await loadTenants();
      } catch (error) {
        // ignore unauthenticated state
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [loadTenants]);

  const onSwitch = async (tenantId: number) => {
    if (!tenantId || tenantId === activeTenantId) return;
    setIsBusy(true);
    try {
      const payload = await apiJson("/api/tenants/switch", {
        method: "POST",
        body: JSON.stringify({ tenantId })
      });
      const nextActive = payload?.data?.activeTenantId || tenantId;
      setActiveTenantId(Number(nextActive));
      setStoredTenantId(nextActive);
    } finally {
      setIsBusy(false);
    }
  };

  if (!isReady || memberships.length <= 1) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
      <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Tenant</span>
      <select
        className="bg-transparent text-xs text-slate-100 focus:outline-none"
        value={activeTenantId || ""}
        disabled={isBusy}
        onChange={(event) => onSwitch(Number(event.target.value))}
      >
        {memberships.map((membership) => (
          <option key={membership.tenantId} value={membership.tenantId} className="bg-slate-900">
            {membership.tenantName || `Tenant ${membership.tenantId}`} ({normalizeRole(membership.role)})
          </option>
        ))}
      </select>
    </div>
  );
}
