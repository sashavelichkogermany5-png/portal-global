import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [
      "./test/setup.ts"
    ]
  },
  coverage: {
    provider: "v8",
    include: [
      "app/**/*.ts",
      "app/**/*.tsx"
    ],
    exclude: [
      "app/api/auth/[...nextauth]/route.ts",
      "node_modules/**",
      "test/**"
    ]
  }
});