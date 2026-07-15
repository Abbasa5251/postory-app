import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig "@/*" -> "./src/*" (single mapping; avoids a
      // vite-tsconfig-paths dep for one line).
      "@": path.resolve(root, "src"),
      // 'server-only' throws outside a React Server environment; stub it so
      // tests can import server modules (DAL/domain tests from A5/A8 on).
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    // Tests must never depend on a real environment; modules that pull in
    // @/lib/env/server load with validation skipped (same escape hatch as
    // the better-auth CLI). Requires the exact string "1".
    env: { SKIP_ENV_VALIDATION: "1" },
    // The two merge-gate suites from AGENTS.md §11. Playwright owns tests/e2e.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "authz",
          environment: "node",
          include: ["tests/authz/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
