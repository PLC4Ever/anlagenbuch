import { test, expect } from "@playwright/test";

const PLANT = process.env.PLANT_SLUG || "MS_DEMO_ANLAGE_01";

test("UI-04/05 offline queue and sync", async ({ page, context }) => {
  await page.goto(`/Schichtbuch/${PLANT}`);

  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible();

  await page.getByTestId("author-name").fill("Offline User");
  await page.getByTestId("subject").fill("Offline Subject");
  await page.getByTestId("body").fill("Offline Body");
  await page.getByTestId("submit-entry").click();

  await context.setOffline(false);
  await expect
    .poll(async () => {
      return await page.evaluate((plant) => {
        const raw = localStorage.getItem(`queue:${plant}`) || "[]";
        try {
          return JSON.parse(raw).length;
        } catch {
          return 999;
        }
      }, PLANT);
    })
    .toBe(0);
});

