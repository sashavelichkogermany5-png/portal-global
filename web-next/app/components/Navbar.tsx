import Link from "next/link";
import TenantSwitcher from "./TenantSwitcher";

export default function Navbar() {
  const isDev = process.env.NODE_ENV !== "production";
  const previewBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
  const previewHref = `${previewBase.replace(/\/$/, "")}/static/preview.html`;

  return (
    <header className="w-full px-6 py-4 bg-black border-b border-white/10">
      <nav className="max-w-6xl mx-auto flex items-center justify-between text-white">
        <Link href="/" className="font-bold text-lg">
          PORTAL
        </Link>

        <div className="flex items-center gap-4 text-sm">
          <TenantSwitcher />
          <Link href="/orders" className="hover:underline">
            Orders
          </Link>
          {isDev ? (
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              Preview
            </a>
          ) : null}
          <Link href="/login" className="hover:underline">
            Login
          </Link>
        </div>
      </nav>
    </header>
  );
}
