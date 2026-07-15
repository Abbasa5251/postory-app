import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  // Chromium only for now: golden paths, keep runs cheap. Add engines when a
  // real cross-browser bug appears.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Next's Playwright guide: run e2e against the production build.
    // `next build`/`next start` load .env automatically for local runs.
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    // Reuse is opt-in (PW_REUSE_SERVER=1) rather than default-on locally:
    // a running dev server on :3000 would silently replace the production
    // artifact this suite claims to test.
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 180_000,
  },
});
