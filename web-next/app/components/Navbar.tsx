import Link from "next/link";
import TenantSwitcher from "./TenantSwitcher";

export default function Navbar() {
  const isDev = process.env.NODE_ENV !== "production";
  const previewBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
  const previewHref = `${previewBase.replace(/\/$/, "")}/static/preview.html`;
  const navItems = [
    { href: "/app", label: "AI Workspace" },
    { href: "/workspace", label: "Workspace" },
    { href: "/orders", label: "Orders" },
    { href: "/app/control", label: "Control" }
  ];

  return (
    <header className="w-full border-b border-white/10 bg-black/95 px-6 py-4 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-white">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/" className="text-lg font-semibold tracking-[0.08em] text-white">
            PORTAL Global
          </Link>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-300">
            Business Ops AI
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
          <TenantSwitcher />
          {isDev ? (
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              Preview
            </a>
          ) : null}
          <Link href="/login?returnUrl=%2Fapp" className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/15">
            Sign in
          </Link>
        </div>
      </nav>
    </header>
  );
}
