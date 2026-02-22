import { test, expect } from "@playwright/test";

const PLANT = process.env.PLANT_SLUG || "MS_DEMO_ANLAGE_01";

test("Ticket create and public status page", async ({ page }) => {
  await page.goto(`/Tickets/${PLANT}`);

  await page.getByPlaceholder("Name").fill("Ticket UI");
  await page.getByPlaceholder("Betreff").fill("UI Ticket Subject");
  await page.getByPlaceholder("Beschreibung").fill("UI Ticket Description");
  await page.getByRole("button", { name: "Ticket senden" }).click();

  await expect(page.locator("text=Ticket erstellt")).toBeVisible();
  await expect(page.locator("a", { hasText: "Status aufrufen" })).toBeVisible();
  await page.getByRole("link", { name: "Status aufrufen" }).click();
  await expect(page.locator(`text=Ticket Dashboard: ${PLANT}`)).toBeVisible();
});

