import { test, expect } from "@playwright/test";

test("Dispatcher and Endbearbeiter start pages use role defaults", async ({ page }) => {
  await page.goto("/dispatcher");
  await expect(page.getByRole("heading", { name: "Dispatcher Anmeldung" })).toBeVisible();
  await expect(page.getByPlaceholder("username")).toHaveValue("dispatcher_ms");

  await page.goto("/endbearbeiter");
  await expect(page.getByRole("heading", { name: "Endbearbeiter Anmeldung" })).toBeVisible();
  await expect(page.getByPlaceholder("username")).toHaveValue("agent_ms_1");
});
