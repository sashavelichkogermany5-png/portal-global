import Link from "next/link";
import TenantSwitcher from "./TenantSwitcher";

export default function Navbar() {
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
          <Link href="/login" className="hover:underline">
            Login
          </Link>
        </div>
      </nav>
    </header>
  );
}
