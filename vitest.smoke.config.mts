import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Isolated config for the LIVE SRH smoke test (tests/integration). Deliberately
// separate from vitest.config.mts's CI `unit`/`authz` projects — this needs a
// running SRH+redis endpoint and must never run in the merge gate.
//   npm run test:smoke:srh
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    // Let real UPSTASH_* flow through @/lib/env/server without demanding the
    // full production env surface (DB/auth/etc.) the smoke test doesn't use.
    env: { SKIP_ENV_VALIDATION: "1" },
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
  },
});
