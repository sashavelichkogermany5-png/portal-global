"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  authMe,
  getPortalMessages,
  getPortalOverview,
  runPortalTool,
  sendPortalMessage
} from "../lib/api-client";

type SuggestedAction = {
  id: string;
  label: string;
  prompt: string;
};

type LeadItem = {
  id: number;
  name?: string | null;
  company?: string | null;
  source?: string | null;
  status: string;
  statusLabel: string;
  estValueEur: number;
  nextTouchAt?: string | null;
  needsHuman?: boolean;
  isStuck?: boolean;
};

type PaymentRequest = {
  id: number;
  title: string;
  amountEur: number;
  currency: string;
  status: string;
  provider: string;
  paymentUrl?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  leadId?: number | null;
  offerId?: number | null;
};

type IntegrationItem = {
  provider: string;
  status: string;
  mode?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
};

type ExceptionItem = {
  type: string;
  severity: string;
  label: string;
  detail: string;
  ref: string;
};

type QueueJob = {
  id: number;
  queueName: string;
  status: string;
  attemptCount: number;
  runAt: string;
  lastError?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

type QueueHealth = {
  worker: {
    workerId?: string | null;
    lastHeartbeatAt?: string | null;
    online: boolean;
  };
  totals: {
    due: number;
    delayed: number;
    staleLocks: number;
    running: number;
    retryWait: number;
    failed: number;
  };
  items: Array<{
    queueName: string;
    queued: number;
    running: number;
    retryWait: number;
    failed: number;
    completed: number;
    delayed: number;
  }>;
};

type OnboardingRun = {
  id: number;
  progress: number;
  status: string;
  checklist: Array<{
    key: string;
    label: string;
    status: string;
  }>;
};

type PortalEvent = {
  id: number;
  category: string;
  eventName: string;
  status: string;
  message: string;
  createdAt: string;
};

type MessageCard = {
  type: string;
  title: string;
  items: Array<{
    id?: number;
    label: string;
    detail?: string;
    value?: string | null;
  }>;
};

type PortalMessage = {
  id: number;
  role: string;
  sender: string;
  message: string;
  createdAt: string;
  payload?: {
    cards?: MessageCard[];
    suggestedActions?: SuggestedAction[];
  } | null;
};

type Overview = {
  productState: string;
  statusLine: string;
  aiMode: string;
  suggestedActions: SuggestedAction[];
  leads: {
    total: number;
    stuckCount: number;
    needsHumanCount: number;
    byStatus: Record<string, { label: string; count: number; valueEur: number }>;
    stuckLeads: LeadItem[];
  };
  revenue: {
    bookedEur: number;
    paymentsReceived: number;
    pendingEur: number;
    pendingCount: number;
    proposalValueEur: number;
    proposalCount: number;
    wonLeads: number;
    latestRequests: PaymentRequest[];
  };
  integrations: {
    connectedCount: number;
    attentionCount: number;
    items: IntegrationItem[];
  };
  knowledge: {
    articleCount: number;
    packCount: number;
    latestPack?: {
      name: string;
      summary: string;
      recordCount: number;
    } | null;
  };
  exceptions: {
    total: number;
    providerFallbacks: number;
    items: ExceptionItem[];
    failedJobs: QueueJob[];
    retryJobs: QueueJob[];
    delayedJobs: QueueJob[];
  };
  queues: QueueHealth;
  onboarding?: OnboardingRun | null;
  recentActions: PortalEvent[];
  featureFlags: {
    portalShell: boolean;
    chatOrchestrator: boolean;
    aiGateway: boolean;
    googleSheetsSync: boolean;
  };
};

type ApiEnvelope<T> = T & { data?: T };

const SESSION_KEY = "portal.chat.session";

type WorkspaceModule = {
  id: string;
  label: string;
  title: string;
  description: string;
  status: "Live route" | "AI guided" | "Placeholder";
  prompt?: string;
  href?: string;
  hrefLabel?: string;
  placeholderTitle: string;
  placeholderBody: string;
  capabilities: string[];
};

const unwrapData = <T extends object>(payload: unknown): T => {
  const record = payload && typeof payload === "object" ? payload as ApiEnvelope<T> : {} as ApiEnvelope<T>;
  if (record.data && typeof record.data === "object") {
    return record.data;
  }
  return record;
};

const createSessionId = () => {
  if (typeof window === "undefined") return `chat-${Date.now()}`;
  if (typeof window.crypto?.randomUUID === "function") {
    return `chat-${window.crypto.randomUUID()}`;
  }
  return `chat-${Date.now()}`;
};

const readSessionId = () => {
  if (typeof window === "undefined") return null;
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = createSessionId();
  window.localStorage.setItem(SESSION_KEY, created);
  return created;
};

const formatMoney = (value?: number) => `EUR ${Number(value || 0).toFixed(0)}`;

const formatTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const roleIsUserMessage = (role?: string) => role === "user";

const platformNavItems = [
  { href: "/app", label: "AI Workspace" },
  { href: "/workspace", label: "Workspace" },
  { href: "/orders", label: "Orders" },
  { href: "/app/control", label: "Control cockpit" }
];

const workspaceModules: WorkspaceModule[] = [
  {
    id: "customers",
    label: "Customer hub",
    title: "Keep customer context, owners, and next steps in one tenant-safe place.",
    description: "Use the workspace to turn customer notes, onboarding context, and follow-up ownership into a shared operational record.",
    status: "AI guided",
    prompt: "Show customer pipeline, onboarding owners, and next follow-up actions.",
    placeholderTitle: "Customer workspace placeholder",
    placeholderBody: "Customer records are still routed through the AI workspace and entity pages. This module keeps the future surface visible without replacing the current flow.",
    capabilities: [
      "Customer notes and handoff context",
      "Owner assignment and next-step visibility",
      "Tenant-safe operating history"
    ]
  },
  {
    id: "orders",
    label: "Orders",
    title: "Run order intake, file collection, and handoff from the same platform.",
    description: "Orders stay available as a working route while the AI workspace becomes the primary control layer.",
    status: "Live route",
    prompt: "Summarize pending orders, required files, and follow-up risks.",
    href: "/orders",
    hrefLabel: "Open orders",
    placeholderTitle: "Orders are live",
    placeholderBody: "The existing orders route stays intact. This card adds a clearer business entry point and an AI handoff prompt without changing the current upload flow.",
    capabilities: [
      "File-backed order intake",
      "Operational handoff from chat to fulfillment",
      "Compatible with the current upload workflow"
    ]
  },
  {
    id: "workflows",
    label: "Workflow studio",
    title: "Track work across teams, queues, and operating stages with AI assistance.",
    description: "Use the shell to surface blocked workflows, next actions, and business handoffs before they become manual chaos.",
    status: "AI guided",
    prompt: "Show active workflows, blocked steps, and the next operator actions.",
    placeholderTitle: "Workflow surface placeholder",
    placeholderBody: "Workflow orchestration is still chat-first. This placeholder keeps the module visible while preserving the current routing and automation foundations.",
    capabilities: [
      "Operator-first next-action visibility",
      "Stage-based work coordination",
      "Cross-team handoff prompts"
    ]
  },
  {
    id: "automation",
    label: "Automation center",
    title: "See what is automated, what is delayed, and where a human should step in.",
    description: "Automation health belongs beside runtime controls, retries, and exception handling so teams can trust the system.",
    status: "Live route",
    prompt: "Review automations, delayed jobs, and manual fallback recommendations.",
    href: "/app/control",
    hrefLabel: "Open control cockpit",
    placeholderTitle: "Automation control is live",
    placeholderBody: "The runtime control cockpit already exists. This module adds clearer language and a direct AI handoff for operational decisions.",
    capabilities: [
      "Job health and retry visibility",
      "Manual fallback guidance",
      "Control cockpit drill-down"
    ]
  },
  {
    id: "qr-access",
    label: "QR access",
    title: "Prepare QR-based entry, check-in, and field access workflows without cluttering the core app.",
    description: "Keep QR access visible as a business module while the current foundation stays stable and tenant-scoped.",
    status: "Placeholder",
    placeholderTitle: "QR access placeholder",
    placeholderBody: "QR workflows are not wired yet. This clean placeholder keeps the future module visible and tenant-safe while the current routes remain unchanged.",
    capabilities: [
      "Check-in and access experiences",
      "Field-ready handoff and verification",
      "Tenant-scoped rollout planning"
    ]
  },
  {
    id: "service-tools",
    label: "Service tools",
    title: "Coordinate service work, operator requests, and internal tasks in one business workspace.",
    description: "Turn chat requests into structured service actions without forcing teams into a separate tool before the workflow is ready.",
    status: "AI guided",
    prompt: "Show urgent service tasks, owner assignments, and blocked requests.",
    placeholderTitle: "Service operations placeholder",
    placeholderBody: "Service operations are still AI-guided instead of a dedicated page. This placeholder keeps the module discoverable with a clean future state.",
    capabilities: [
      "Service backlog visibility",
      "Owner-based task routing",
      "Shared operational follow-up"
    ]
  },
  {
    id: "adaptive-agents",
    label: "Adaptive agents",
    title: "Give each tenant an AI operating layer that stays inside its own workspace and context.",
    description: "Adaptive agents should feel like part of the tenant workspace, not a separate demo surface or shared global bot.",
    status: "AI guided",
    prompt: "Brief the tenant agent on today's priorities, exceptions, and recommended next actions.",
    placeholderTitle: "Tenant agent placeholder",
    placeholderBody: "Adaptive agents already work through tenant-safe prompts and chat actions. This placeholder clarifies the future module surface without changing auth, sessions, or isolation.",
    capabilities: [
      "Tenant-specific AI operating context",
      "Recommendations based on current platform state",
      "Safe routing inside existing workspace boundaries"
    ]
  }
];

export default function AppPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [authState, setAuthState] = useState<"loading" | "ready" | "guest">("loading");
  const [composerValue, setComposerValue] = useState("");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSeedingDemo, setIsSeedingDemo] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState(workspaceModules[0]?.id ?? "customers");

  useEffect(() => {
    setSessionId(readSessionId());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get("thread");
    if (!threadId) return;
    window.localStorage.setItem(SESSION_KEY, threadId);
    setSessionId(threadId);
  }, []);

  const loadApp = useCallback(async (activeSessionId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsRefreshing(true);
    }
    setErrorText("");
    try {
      const me = unwrapData<{ userId?: number | string | null; isGuest?: boolean }>(await authMe());
      if (!me?.userId || me?.isGuest) {
        setAuthState("guest");
        setOverview(null);
        setMessages([]);
        return;
      }
      const [overviewPayload, messagesPayload] = await Promise.all([
        getPortalOverview(),
        getPortalMessages(activeSessionId)
      ]);
      setOverview(unwrapData<Overview>(overviewPayload));
      const chatMessages = unwrapData<PortalMessage[]>(messagesPayload);
      setMessages(Array.isArray(chatMessages) ? chatMessages : []);
      setAuthState("ready");
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setAuthState("guest");
        setOverview(null);
        setMessages([]);
      } else {
        setErrorText(err instanceof Error ? err.message : "Failed to load the portal shell.");
      }
    } finally {
      if (!options?.silent) {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    loadApp(sessionId).catch(() => {});
  }, [sessionId, loadApp]);

  useEffect(() => {
    if (!sessionId || authState !== "ready") return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadApp(sessionId, { silent: true }).catch(() => {});
    }, 6000);
    return () => {
      window.clearInterval(interval);
    };
  }, [authState, loadApp, sessionId]);

  const sendMessage = useCallback(async (messageText: string) => {
    const activeSessionId = sessionId || readSessionId();
    if (!activeSessionId) return;
    setSessionId(activeSessionId);
    setIsBusy(true);
    setStatusText("Working...");
    setErrorText("");
    try {
      const payload = await sendPortalMessage({
        sessionId: activeSessionId,
        message: messageText
      });
      const data = unwrapData<{
        overview: Overview;
        messages: PortalMessage[];
        reply: string;
      }>(payload);
      setOverview(data.overview || null);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setComposerValue("");
      setStatusText(data.reply || "Done.");
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to process your request.");
      setStatusText("");
    } finally {
      setIsBusy(false);
    }
  }, [sessionId]);

  const handleSeedDemo = useCallback(async () => {
    setIsSeedingDemo(true);
    setStatusText("Seeding demo flow...");
    setErrorText("");
    try {
      await runPortalTool("seedDemo");
      const activeSessionId = sessionId || readSessionId();
      if (activeSessionId) {
        await loadApp(activeSessionId, { silent: true });
      }
      setStatusText("Demo flow seeded.");
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Failed to seed demo data.");
      setStatusText("");
    } finally {
      setIsSeedingDemo(false);
    }
  }, [loadApp, sessionId]);

  const statusPills = useMemo(() => {
    if (!overview) return [];
    return [
      { label: overview.productState, tone: "amber" },
      { label: overview.aiMode, tone: "teal" },
      { label: `${overview.exceptions.total} exceptions`, tone: overview.exceptions.total ? "rose" : "slate" }
    ];
  }, [overview]);

  const leadStages = useMemo(() => {
    if (!overview) return [];
    return Object.entries(overview.leads.byStatus);
  }, [overview]);

  const activeModule = useMemo(
    () => workspaceModules.find((module) => module.id === activeModuleId) || workspaceModules[0],
    [activeModuleId]
  );

  const stageModuleAction = useCallback((module: WorkspaceModule) => {
    setActiveModuleId(module.id);
    setErrorText("");
    if (module.prompt) {
      setComposerValue(module.prompt);
      setStatusText(`${module.label} action added to the chat composer.`);
      return;
    }
    setStatusText(`${module.label} is available as a clean placeholder while the module is being finished.`);
  }, []);

  if (authState === "loading") {
    return (
      <main
        className="min-h-screen text-stone-100"
        style={{
          fontFamily: '"Space Grotesk", sans-serif',
          background:
            "radial-gradient(circle at 18% 18%, rgba(245, 158, 11, 0.22), transparent 42%), radial-gradient(circle at 82% 12%, rgba(20, 184, 166, 0.18), transparent 38%), linear-gradient(165deg, #09070a 0%, #171115 46%, #0d1c1c 100%)"
        }}
      >
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-16">
          <div className="rounded-[28px] border border-white/10 bg-white/6 px-6 py-5 text-center shadow-[0_32px_90px_rgba(8,8,12,0.45)] backdrop-blur-xl">
            <p className="text-xs uppercase tracking-[0.28em] text-teal-200">Portal Global</p>
            <p className="mt-3 text-sm text-stone-300">Checking session...</p>
          </div>
        </div>
      </main>
    );
  }

  if (authState === "guest") {
    return (
      <main
        className="min-h-screen text-stone-100"
        style={{
          fontFamily: '"Space Grotesk", sans-serif',
          background:
            "radial-gradient(circle at 18% 18%, rgba(245, 158, 11, 0.22), transparent 42%), radial-gradient(circle at 82% 12%, rgba(20, 184, 166, 0.18), transparent 38%), linear-gradient(165deg, #09070a 0%, #171115 46%, #0d1c1c 100%)"
        }}
      >
        <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-16">
          <div className="grid w-full gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="inline-flex rounded-full border border-white/10 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.32em] text-amber-200">
                Portal Global
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
                One chat to run lead intake, revenue, onboarding, and follow-up.
              </h1>
              <p className="max-w-2xl text-base text-stone-300 md:text-lg">
                The main product shell is now chat-first. The platform routes a plain-language request into lead actions, offers, payment requests, onboarding, integrations, and exception handling.
              </p>
              <div className="grid gap-3 text-sm text-stone-400">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Free mode works without premium AI keys.</div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">BYOK and hybrid AI routes are ready through the unified gateway.</div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">Google Sheets, knowledge packs, and exception panels stay secondary to the chat workflow.</div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/7 p-8 shadow-[0_32px_90px_rgba(8,8,12,0.45)] backdrop-blur-xl">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.28em] text-teal-200">Get in</p>
                <h2 className="text-3xl font-semibold">Open the chat-first shell</h2>
                <p className="text-sm text-stone-400">
                  Sign in to your tenant, or jump in with the local demo account and test the full MVP contour.
                </p>
              </div>
              <div className="mt-8 grid gap-3">
                <Link
                  href="/login?demo=1&returnUrl=%2Fapp"
                  className="rounded-2xl bg-amber-200 px-5 py-4 text-center text-sm font-semibold text-stone-900 transition hover:bg-amber-100"
                >
                  Use demo account
                </Link>
                <Link
                  href="/login?returnUrl=%2Fapp"
                  className="rounded-2xl border border-white/10 bg-stone-950/50 px-5 py-4 text-center text-sm font-semibold text-stone-100 transition hover:border-teal-300/50 hover:text-teal-100"
                >
                  Sign in
                </Link>
                <Link
                  href="/register?returnUrl=%2Fapp"
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center text-sm font-semibold text-stone-100 transition hover:border-white/25"
                >
                  Create workspace account
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen text-stone-100"
      style={{
        fontFamily: '"Space Grotesk", sans-serif',
        background:
          "radial-gradient(circle at 18% 15%, rgba(245, 158, 11, 0.2), transparent 38%), radial-gradient(circle at 82% 12%, rgba(13, 148, 136, 0.2), transparent 34%), linear-gradient(165deg, #09070a 0%, #171115 46%, #0d1c1c 100%)"
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-8 px-5 py-6 md:px-8 md:py-8">
        <header className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.03))] p-6 shadow-[0_30px_90px_rgba(7,8,12,0.45)] backdrop-blur-xl md:p-8">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/70 to-transparent"></div>
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex rounded-full border border-white/10 bg-white/6 px-4 py-2 text-[11px] uppercase tracking-[0.32em] text-amber-200">
                  Chat-First Autonomous Ops
                </span>
                {statusPills.map((pill) => (
                  <span
                    key={pill.label}
                    className={`rounded-full border px-3 py-1 text-xs ${pill.tone === "amber"
                      ? "border-amber-200/30 bg-amber-200/10 text-amber-100"
                      : pill.tone === "teal"
                        ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
                        : pill.tone === "rose"
                          ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
                          : "border-white/10 bg-white/5 text-stone-300"}`}
                  >
                    {pill.label}
                  </span>
                ))}
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold leading-tight md:text-5xl">
                  Portal Global runs the whole lead-to-launch contour from one chat.
                </h1>
                <p className="max-w-3xl text-sm text-stone-300 md:text-base">
                  {overview?.statusLine || "Loading product state..."}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-stone-950/35 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Primary entry</p>
                  <p className="mt-2 text-lg font-medium text-stone-100">Chat</p>
                  <p className="mt-2 text-sm text-stone-400">Intent parsing, tool routing, AI fallback, and audit logs stay in one thread.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/35 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Product state</p>
                  <p className="mt-2 text-lg font-medium text-stone-100">{overview?.productState || "Checking"}</p>
                  <p className="mt-2 text-sm text-stone-400">Leads, revenue, onboarding, integrations, and exceptions are summarized without admin noise.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/35 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">AI routing</p>
                  <p className="mt-2 text-lg font-medium text-stone-100">{overview?.aiMode || "Loading"}</p>
                  <p className="mt-2 text-sm text-stone-400">Core logic works without paid LLMs, then upgrades to hybrid or BYOK when configured.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-stone-950/45 p-5 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-teal-200">Suggested actions</p>
                  <h2 className="mt-2 text-xl font-semibold">Move the platform forward</h2>
                </div>
                <button
                  type="button"
                  onClick={() => sessionId && loadApp(sessionId)}
                  disabled={isRefreshing}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200 transition hover:border-teal-300/40 hover:text-teal-100 disabled:opacity-60"
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              <div className="mt-5 grid gap-3">
                {(overview?.suggestedActions || []).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => sendMessage(action.prompt)}
                    disabled={isBusy}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-amber-200/45 hover:bg-white/8 disabled:opacity-60"
                  >
                    <span className="text-sm text-stone-100">{action.label}</span>
                    <span className="text-xs uppercase tracking-[0.22em] text-stone-500">Run</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-5">
            {platformNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200 transition hover:border-white/25 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.28fr_0.72fr]">
          <div className="rounded-[30px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Business modules</p>
                <h2 className="mt-2 text-2xl font-semibold">One platform for business operations</h2>
              </div>
              <div className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-teal-100">
                Add-only upgrade
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {workspaceModules.map((module) => (
                <article
                  key={module.id}
                  className={`rounded-[24px] border p-4 transition ${activeModule?.id === module.id
                    ? "border-amber-200/30 bg-amber-200/10"
                    : "border-white/10 bg-stone-950/35"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-stone-500">{module.label}</p>
                      <h3 className="mt-2 text-lg font-semibold text-stone-100">{module.title}</h3>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.16em] ${module.status === "Live route"
                      ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
                      : module.status === "AI guided"
                        ? "border-amber-200/30 bg-amber-200/10 text-amber-100"
                        : "border-white/10 bg-white/5 text-stone-300"}`}>
                      {module.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-stone-300">{module.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => stageModuleAction(module)}
                      className="rounded-xl bg-amber-200 px-3 py-2 text-xs font-semibold text-stone-900 transition hover:bg-amber-100"
                    >
                      {module.prompt ? "Load action" : "View placeholder"}
                    </button>
                    {module.href ? (
                      <Link
                        href={module.href}
                        onClick={() => setActiveModuleId(module.id)}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-stone-200 transition hover:border-white/25 hover:text-white"
                      >
                        {module.hrefLabel || "Open module"}
                      </Link>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-[30px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Module focus</p>
                <h2 className="mt-2 text-2xl font-semibold">{activeModule.title}</h2>
                <p className="mt-3 text-sm leading-6 text-stone-300">{activeModule.description}</p>
              </div>
              <div className="space-y-2">
                {activeModule.capabilities.map((capability) => (
                  <div key={capability} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm text-stone-200">
                    {capability}
                  </div>
                ))}
              </div>
              <div className="rounded-[24px] border border-white/10 bg-stone-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{activeModule.status}</p>
                <p className="mt-2 text-base font-semibold text-stone-100">{activeModule.placeholderTitle}</p>
                <p className="mt-2 text-sm leading-6 text-stone-300">{activeModule.placeholderBody}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => stageModuleAction(activeModule)}
                  className="rounded-2xl bg-amber-200 px-4 py-3 text-sm font-semibold text-stone-900 transition hover:bg-amber-100"
                >
                  {activeModule.prompt ? "Stage in chat" : "Keep placeholder"}
                </button>
                {activeModule.href ? (
                  <Link
                    href={activeModule.href}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-200 transition hover:border-white/25 hover:text-white"
                  >
                    {activeModule.hrefLabel || "Open module"}
                  </Link>
                ) : null}
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
          <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] p-4 shadow-[0_28px_90px_rgba(7,8,12,0.42)] backdrop-blur-xl md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-stone-400">Main console</p>
                <h2 className="mt-2 text-2xl font-semibold">Chat</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSeedDemo}
                  disabled={isSeedingDemo}
                  className="rounded-xl border border-white/10 bg-white/6 px-4 py-2 text-sm text-stone-200 transition hover:border-amber-200/45 hover:text-amber-100 disabled:opacity-60"
                >
                  {isSeedingDemo ? "Seeding..." : "Seed demo"}
                </button>
                <Link
                  href="/admin"
                  className="rounded-xl border border-white/10 bg-stone-950/50 px-4 py-2 text-sm text-stone-300 transition hover:border-white/25 hover:text-white"
                >
                  Admin
                </Link>
              </div>
            </div>

            <div className="mt-4 h-[420px] overflow-y-auto rounded-[24px] border border-white/10 bg-stone-950/45 p-4 md:h-[520px]">
              {!messages.length ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-stone-400">
                  <div className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.3em] text-amber-200">
                    Ready
                  </div>
                  <h3 className="text-2xl font-semibold text-stone-100">Use plain language</h3>
                  <p className="max-w-xl text-sm text-stone-400">
                    Try: &quot;Connect Google Sheets&quot;, &quot;Show stuck leads&quot;, &quot;Generate offer&quot;, &quot;Create payment request&quot;, or &quot;Start onboarding&quot;.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => {
                    const isUser = roleIsUserMessage(message.role);
                    return (
                      <article key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[88%] rounded-[24px] border px-4 py-4 ${isUser
                          ? "border-amber-200/20 bg-amber-200/10 text-amber-50"
                          : "border-white/10 bg-white/5 text-stone-100"}`}>
                          <div className="flex items-center justify-between gap-4 text-xs uppercase tracking-[0.2em] text-stone-500">
                            <span>{isUser ? "You" : message.sender}</span>
                            <span>{formatTime(message.createdAt)}</span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-inherit">
                            {message.message}
                          </p>
                          {!isUser && message.payload?.cards?.length ? (
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              {message.payload.cards.map((card) => (
                                <div key={`${message.id}-${card.title}`} className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                                  <p className="text-sm font-semibold text-stone-100">{card.title}</p>
                                  <div className="mt-3 space-y-2 text-sm text-stone-300">
                                    {card.items.map((item, index) => (
                                      <div key={`${card.title}-${item.label}-${index}`} className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2">
                                        <div className="flex items-center justify-between gap-3">
                                          <span>{item.label}</span>
                                          {item.value ? <span className="text-stone-100">{item.value}</span> : null}
                                        </div>
                                        {item.detail ? <p className="mt-1 text-xs text-stone-500">{item.detail}</p> : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-[24px] border border-white/10 bg-stone-950/45 p-4">
              <label className="sr-only" htmlFor="portal-chat-composer">Message</label>
              <textarea
                id="portal-chat-composer"
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                placeholder="Ask in plain language: Connect Google Sheets, show new leads, run follow-up, create offer, start onboarding..."
                rows={4}
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-teal-300/45"
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 text-xs text-stone-500">
                  <button type="button" onClick={() => setComposerValue("Connect Google Sheets")} className="rounded-full border border-white/10 px-3 py-1 hover:border-white/25 hover:text-stone-300">Connect Sheets</button>
                  <button type="button" onClick={() => setComposerValue("Show stuck leads")} className="rounded-full border border-white/10 px-3 py-1 hover:border-white/25 hover:text-stone-300">Stuck leads</button>
                  <button type="button" onClick={() => setComposerValue("Generate offer")} className="rounded-full border border-white/10 px-3 py-1 hover:border-white/25 hover:text-stone-300">Generate offer</button>
                </div>
                <button
                  type="button"
                  onClick={() => sendMessage(composerValue)}
                  disabled={isBusy || !composerValue.trim()}
                  className="rounded-2xl bg-amber-200 px-5 py-3 text-sm font-semibold text-stone-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? "Running..." : "Send"}
                </button>
              </div>
              {statusText ? <p className="mt-3 text-sm text-teal-200">{statusText}</p> : null}
              {errorText ? <p className="mt-3 text-sm text-rose-300">{errorText}</p> : null}
            </div>
          </div>

          <div className="grid gap-4">
            <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Revenue</p>
                  <h3 className="mt-2 text-xl font-semibold">Snapshot</h3>
                </div>
                <span className="text-sm text-stone-500">{overview?.revenue.pendingCount || 0} pending</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Booked</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-100">{formatMoney(overview?.revenue.bookedEur)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Pending</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-100">{formatMoney(overview?.revenue.pendingEur)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Won leads</p>
                  <p className="mt-2 text-2xl font-semibold text-teal-100">{overview?.revenue.wonLeads || 0}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {(overview?.revenue.latestRequests || []).slice(0, 3).map((request) => (
                  <div key={request.id} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-stone-100">
                      <span>{request.title}</span>
                      <span>{formatMoney(request.amountEur)}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{request.status} · {request.provider} · due {formatTime(request.dueAt)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Queues</p>
                  <h3 className="mt-2 text-xl font-semibold">Health</h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm ${overview?.queues.worker.online ? "text-teal-200" : "text-rose-200"}`}>
                    {overview?.queues.worker.online ? "worker online" : "worker offline"}
                  </span>
                  <Link href="/app/control" className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-stone-200 transition hover:border-white/25 hover:text-white">
                    Open cockpit
                  </Link>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Due</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-100">{overview?.queues.totals.due || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Running</p>
                  <p className="mt-2 text-2xl font-semibold text-teal-100">{overview?.queues.totals.running || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Retry wait</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-100">{overview?.queues.totals.retryWait || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Delayed</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-100">{overview?.queues.totals.delayed || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Failed</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-200">{overview?.queues.totals.failed || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Stale locks</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-100">{overview?.queues.totals.staleLocks || 0}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {(overview?.queues.items || []).map((item) => (
                  <div key={item.queueName} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-stone-100">
                      <span>{item.queueName.replace(/_/g, " ")}</span>
                      <span className="text-xs text-stone-500">run {item.running} · retry {item.retryWait} · fail {item.failed}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">due {item.queued} · delayed {item.delayed} · completed {item.completed}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-stone-500">Last heartbeat: {formatTime(overview?.queues.worker.lastHeartbeatAt)}</p>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Integrations</p>
                  <h3 className="mt-2 text-xl font-semibold">Status</h3>
                </div>
                <span className="text-sm text-stone-500">{overview?.integrations.connectedCount || 0} connected</span>
              </div>
              <div className="mt-4 space-y-2">
                {(overview?.integrations.items || []).slice(0, 6).map((item) => (
                  <div key={item.provider} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-stone-100">
                      <span>{item.provider.replace(/_/g, " ")}</span>
                      <span className={`${item.status === "connected" ? "text-teal-200" : item.status === "attention_needed" || item.status === "error" ? "text-rose-200" : "text-stone-400"}`}>{item.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{item.mode || "manual"}{item.lastSyncedAt ? ` · synced ${formatTime(item.lastSyncedAt)}` : ""}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Knowledge</p>
                  <h3 className="mt-2 text-xl font-semibold">Status</h3>
                </div>
                <span className="text-sm text-stone-500">{overview?.knowledge.packCount || 0} packs</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Articles</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-100">{overview?.knowledge.articleCount || 0}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Latest pack</p>
                  <p className="mt-2 text-base font-semibold text-stone-100">{overview?.knowledge.latestPack?.name || "No pack yet"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-stone-950/45 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Exceptions</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-200">{overview?.exceptions.total || 0}</p>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[30px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Leads</p>
                <h3 className="mt-2 text-2xl font-semibold">Pipeline</h3>
              </div>
              <div className="text-sm text-stone-500">{overview?.leads.total || 0} total · {overview?.leads.stuckCount || 0} stuck</div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {leadStages.map(([key, stage]) => (
                <div key={key} className="rounded-2xl border border-white/10 bg-stone-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">{stage.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-100">{stage.count}</p>
                  <p className="mt-2 text-xs text-stone-500">{formatMoney(stage.valueEur)}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-[0.2em] text-stone-400">
                  <tr>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Value</th>
                    <th className="px-4 py-3">Next touch</th>
                    <th className="px-4 py-3">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.leads.stuckLeads || []).map((lead) => (
                    <tr key={lead.id} className="border-t border-white/10 bg-stone-950/25">
                      <td className="px-4 py-3 text-stone-100">{lead.company || lead.name || `Lead #${lead.id}`}</td>
                      <td className="px-4 py-3 text-stone-300">{lead.statusLabel}</td>
                      <td className="px-4 py-3 text-stone-300">{formatMoney(lead.estValueEur)}</td>
                      <td className="px-4 py-3 text-stone-400">{formatTime(lead.nextTouchAt)}</td>
                      <td className="px-4 py-3 text-stone-400">{lead.needsHuman ? "Needs human" : lead.isStuck ? "Stuck" : lead.source || "-"}</td>
                    </tr>
                  ))}
                  {!(overview?.leads.stuckLeads || []).length ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-sm text-stone-500" colSpan={5}>
                        No stuck leads right now.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6">
            <section className="rounded-[30px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Onboarding</p>
                  <h3 className="mt-2 text-2xl font-semibold">Progress</h3>
                </div>
                <span className="text-sm text-stone-500">{overview?.onboarding?.progress || 0}%</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-200 via-amber-100 to-teal-200" style={{ width: `${overview?.onboarding?.progress || 0}%` }}></div>
              </div>
              <div className="mt-4 space-y-2">
                {(overview?.onboarding?.checklist || []).map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm">
                    <span className="text-stone-200">{item.label}</span>
                    <span className={`${item.status === "completed" ? "text-teal-200" : "text-stone-500"}`}>{item.status}</span>
                  </div>
                ))}
                {!(overview?.onboarding?.checklist || []).length ? (
                  <div className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-5 text-sm text-stone-500">
                    Start onboarding from chat or from a paid payment request.
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[30px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Exceptions</p>
                  <h3 className="mt-2 text-2xl font-semibold">Control</h3>
                </div>
                <span className="text-sm text-stone-500">{overview?.exceptions.providerFallbacks || 0} AI fallbacks</span>
              </div>
              <p className="mt-3 text-xs text-stone-500">
                failed {overview?.exceptions.failedJobs.length || 0} · retry {overview?.exceptions.retryJobs.length || 0} · delayed {overview?.exceptions.delayedJobs.length || 0}
              </p>
              <div className="mt-4 space-y-2">
                {(overview?.exceptions.items || []).slice(0, 6).map((item) => (
                  <div key={item.ref} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-stone-100">
                      <span>{item.label}</span>
                      <span className={`${item.severity === "high" ? "text-rose-200" : "text-amber-100"}`}>{item.severity}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{item.detail}</p>
                  </div>
                ))}
                {!(overview?.exceptions.items || []).length ? (
                  <div className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-5 text-sm text-stone-500">
                    No active exceptions. The owner view is clean.
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[30px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Recent actions</p>
                  <h3 className="mt-2 text-2xl font-semibold">Audit trail</h3>
                </div>
                <span className="text-sm text-stone-500">Traceable</span>
              </div>
              <div className="mt-4 space-y-2">
                {(overview?.recentActions || []).slice(0, 6).map((event) => (
                  <div key={event.id} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3 text-stone-100">
                      <span>{event.message}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-stone-500">{event.category}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{formatTime(event.createdAt)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
