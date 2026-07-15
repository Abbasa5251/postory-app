import { expect, test } from "@playwright/test";

// Harness smoke checks (DB-free assertions). The golden-path suites from
// AGENTS.md §11 land with their features (signup→publish etc.).

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
});

test("anonymous visitor is redirected from the dashboard to sign-in", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});
