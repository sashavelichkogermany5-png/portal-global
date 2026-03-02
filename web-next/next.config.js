/** @type {import("next").NextConfig} */
const nextConfig = {
  // Keep dev mode for development
  turbopack: {
    root: __dirname
  },
  // In production, use static export via: npm run build:web
  // This requires: output: "export" + images: { unoptimized: true }
  
  // For now, keep rewrites for dev
  async rewrites() {
    return [
      {
        source: "/api/agent/:path*",
        destination: "http://127.0.0.1:3000/api/agent/:path*"
      }
    ];
  }
};

module.exports = nextConfig;
