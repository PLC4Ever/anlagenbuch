import { test, expect } from "@playwright/test";

test("Admin portal navigation and core actions", async ({ page }) => {
  await page.goto("/admin");

  await page.getByPlaceholder("username").fill("admin_1");
  await page.getByPlaceholder("password").fill("admin_demo_pw_change");
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(page.getByText("Admin Rechte aktiv.")).toBeVisible();

  await page.getByRole("button", { name: "Ops" }).click();
  await page.getByRole("button", { name: "Load ops" }).click();
  await expect(page.getByText("Support Bundle")).toBeVisible();
  await expect(page.getByText("Status + errors")).toBeVisible();

  await page.getByRole("button", { name: "Anlagen & Bereiche" }).click();
  const slug = `ZZ_UI_${Date.now()}`;
  await page.getByPlaceholder("slug").fill(slug);
  await page.getByPlaceholder("display_name").fill(`Plant ${slug}`);
  await page.getByPlaceholder("area_prefix").fill("ZZ");
  await page.getByRole("button", { name: "Create", exact: true }).first().click();

  await expect(page.getByText("Anlage erstellt.")).toBeVisible();
});

