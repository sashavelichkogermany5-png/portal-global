import type { Metadata } from "next";
import Link from "next/link";

import DeEducationCaptureForm from "./components/de-education-capture-form";

export const metadata: Metadata = {
  title: "PORTAL GLOBAL | Ops workspace fuer Kurse, Camps und Programme",
  description:
    "PORTAL GLOBAL ist eine chat-first Multi-Tenant Ops-Plattform fuer kleine Bildungsteams, die Anfragen, Qualifizierung, Angebote, Zahlungsanfragen und Onboarding in einem tenant-safe Workspace fuehren wollen."
};

const painSignals = [
  "Anfragen landen in Formularen, E-Mails, Chats und Tabellen statt in einem Flow.",
  "Status, Angebot, Zahlungsanfrage und naechster Schritt werden manuell nachgetragen.",
  "Zwischen Lead, Client, Offer und Onboarding geht Team-Kontext zu leicht verloren."
];

const flowSteps = [
  "Lead captured",
  "Qualification / triage",
  "Offer or next-step proposal",
  "Payment request",
  "Onboarding / activation"
];

const workflowRules = [
  "Tenant-aware isolation for every core entity.",
  "Operator-first workspace instead of status tracking across external tools.",
  "Manual payment request path first, automation later."
];

const pilotScope = [
  "Workspace shell with auth and tenant switching",
  "Leads, clients, orders, notes, and search inside `/app`",
  "One operator-ready flow from intake to onboarding",
  "Manual payment request handling before billing automation"
];

const whyEducationFirst = [
  "Viele kleine Teams koordinieren Anfragen, Dokumente, Zahlungen und Startinfos noch manuell.",
  "Der operative Flow ist klar genug, um echten Nutzen schnell zu zeigen.",
  "Ein Education-Pilot erzeugt schnelle Signale fuer Positionierung, Outreach und Sales."
];

const appLoginHref = "/login?returnUrl=%2Fapp";
const demoLoginHref = "/login?demo=1&returnUrl=%2Fapp";

export default function Home() {
  return (
    <main
      className="min-h-screen text-stone-100"
      style={{
        fontFamily: '"Space Grotesk", sans-serif',
        background:
          "radial-gradient(circle at 14% 14%, rgba(245, 158, 11, 0.2), transparent 38%), radial-gradient(circle at 84% 10%, rgba(20, 184, 166, 0.18), transparent 34%), linear-gradient(165deg, #09070a 0%, #171115 46%, #0d1c1c 100%)"
      }}
      >
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-10 px-6 py-8 md:px-8 md:py-10">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex rounded-full border border-white/10 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.32em] text-amber-200">
              Portal Global
            </div>
            <nav className="flex flex-wrap items-center gap-3 text-sm text-stone-300">
              <a href="#flow" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/25 hover:text-white">
                Flow
              </a>
              <a href="#trust" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/25 hover:text-white">
                Trust
              </a>
              <Link href={appLoginHref} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-stone-100 transition hover:border-teal-300/40 hover:text-teal-100">
                Sign in
              </Link>
              <Link href={demoLoginHref} className="rounded-full border border-amber-200/25 bg-amber-200/10 px-4 py-2 text-amber-100 transition hover:border-amber-100/40 hover:bg-amber-200/15">
                Use demo account
              </Link>
            </nav>
          </header>

          <section className="grid gap-8 xl:grid-cols-[1.12fr_0.88fr] xl:items-center">
            <div className="space-y-6">
              <div className="inline-flex rounded-full border border-white/10 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.32em] text-teal-200">
                DE pilot for courses, camps, and education programs
              </div>
              <div className="space-y-5">
                <h1 className="max-w-4xl text-4xl font-semibold leading-tight md:text-6xl">
                  Fuehre Anfragen von Lead bis Onboarding in einem tenant-safe Workspace.
                </h1>
                <p className="max-w-3xl text-base text-stone-300 md:text-lg">
                  PORTAL GLOBAL ist eine chat-first Multi-Tenant Ops-Plattform fuer kleine Bildungsteams. Statt den Ablauf ueber Chats, Tabellen, Notizen und Dateien zu verteilen, arbeitet das Team in einem klaren Flow:{" "}
                  <span className="text-stone-100">{"lead -> qualification -> offer -> payment request -> onboarding"}</span>.
                </p>
                <p className="max-w-3xl text-sm uppercase tracking-[0.22em] text-stone-500">
                  Operator-first UX fuer Kurse, Camps und Programme mit gemeinsamem Workspace.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {painSignals.map((item) => (
                  <div key={item} className="rounded-[26px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl">
                    <p className="text-sm leading-6 text-stone-200">{item}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="#pilot-form" className="rounded-2xl bg-amber-200 px-5 py-3 text-sm font-semibold text-stone-900 transition hover:bg-amber-100">
                  Pilot anfragen
                </a>
                <a href="#flow" className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-stone-100 transition hover:border-teal-300/45 hover:text-teal-100">
                  Flow ansehen
                </a>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {workflowRules.map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-stone-950/30 px-4 py-3 text-sm text-stone-300">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <DeEducationCaptureForm />
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <article className="rounded-[30px] border border-white/10 bg-white/6 p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.26em] text-stone-400">Why this hurts now</p>
              <h2 className="mt-3 text-2xl font-semibold">Ein Team braucht einen sichtbaren naechsten Schritt</h2>
              <p className="mt-4 text-sm leading-6 text-stone-300">
                Kleine Operator-Teams kaufen keine weitere Dashboard-Sammlung. Sie brauchen einen Workspace, in dem Qualification, Offer, Zahlungsanfrage und Onboarding nicht mehr zwischen Chat, Tabelle und Datei auseinanderfallen.
              </p>
              <div className="mt-5 space-y-3">
                {painSignals.map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm text-stone-200">
                    {item}
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[30px] border border-amber-200/20 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(255,255,255,0.04))] p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.26em] text-amber-100">First vertical</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <h2 className="text-2xl font-semibold">Warum Education zuerst passt</h2>
                <span className="text-sm text-amber-100">DE pilot</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-200">
                Courses, camps und kleine Programme haben genug operative Reibung fuer einen klaren Pilot: Leads, Follow-up, Angebot, Zahlungsanfrage und Startinfos muessen sauber uebergeben werden.
              </p>
              <div className="mt-5 space-y-3">
                {whyEducationFirst.map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-3 text-sm text-stone-100">
                    {item}
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section id="flow" className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <article className="rounded-[30px] border border-white/10 bg-white/6 p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.26em] text-stone-400">Core flow</p>
              <h2 className="mt-3 text-2xl font-semibold">Eine Demo sollte nur einen Ablauf beweisen</h2>
              <div className="mt-5 space-y-3">
                {flowSteps.map((step, index) => (
                  <div key={step} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-4 text-sm text-stone-200">
                    <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Step {index + 1}</p>
                    <p className="mt-2">{step}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[30px] border border-white/10 bg-white/6 p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.26em] text-stone-400">Pilot scope</p>
              <h2 className="mt-3 text-2xl font-semibold">Was im ersten Live-Flow drin sein muss</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {pilotScope.map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-stone-950/35 px-4 py-4 text-sm text-stone-200">
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-[28px] border border-teal-300/18 bg-teal-300/8 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-teal-100">Market entry CTA</p>
                <p className="mt-3 text-lg font-semibold text-stone-100">Pilot anfragen</p>
                <p className="mt-2 text-sm leading-6 text-stone-300">
                  Der erste Verkaufssignal-Loop ist simpel:{" "}
                  <span className="text-stone-100">{"DE landing -> capture -> manuelles Follow-up -> Demo -> erste Zahlungsanfrage -> Onboarding"}</span>.
                </p>
              </div>
            </article>
          </section>

          <section id="trust" className="grid gap-6 md:grid-cols-3">
            <article className="rounded-[28px] border border-white/10 bg-white/6 p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Tenant trust</p>
              <h2 className="mt-3 text-xl font-semibold">Isolation is the trust layer</h2>
              <p className="mt-4 text-sm leading-6 text-stone-300">
                Core entities muessen tenant-safe bleiben. Kein Cross-tenant Read, kein Cross-tenant Write, kein Leak ueber Header oder Body.
              </p>
            </article>

            <article className="rounded-[28px] border border-white/10 bg-white/6 p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Operator workflow</p>
              <h2 className="mt-3 text-xl font-semibold">Ein Workspace statt Tool-Wechsel</h2>
              <p className="mt-4 text-sm leading-6 text-stone-300">
                Leads, Clients, Zahlungsstatus, Notizen und Onboarding-Schritte gehoeren in einen operablen Ablauf statt in mehrere Systeme.
              </p>
            </article>

            <article className="rounded-[28px] border border-white/10 bg-white/6 p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Revenue readiness</p>
              <h2 className="mt-3 text-xl font-semibold">Manuelle Zahlungsanfrage zuerst</h2>
              <p className="mt-4 text-sm leading-6 text-stone-300">
                Billing-Automation kommt spaeter. Der MVP muss zuerst beweisen, dass Teams den Flow bis zur manuellen Zahlungsanfrage und Aktivierung sauber laufen lassen koennen.
              </p>
            </article>
          </section>
        </div>
      </main>
  );
}
