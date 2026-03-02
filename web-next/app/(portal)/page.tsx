import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-black text-white px-6">
      <h1 className="text-4xl font-bold mb-4">PORTAL Global</h1>

      <p className="text-lg text-gray-300 max-w-xl text-center mb-8">
        Global service platform connecting customers and service providers.
        Orders, bonuses, QR access and automation — worldwide.
      </p>

      <div className="flex gap-4">
        <Link
          href="/orders"
          className="px-6 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition"
        >
          Create order
        </Link>

        <Link
          href="/login"
          className="px-6 py-3 border border-white rounded-lg font-medium hover:bg-white hover:text-black transition"
        >
          Become a provider
        </Link>
      </div>
    </main>
  );
}
