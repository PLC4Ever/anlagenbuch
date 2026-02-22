import { test, expect } from "@playwright/test";

const PLANT = process.env.PLANT_SLUG || "MS_DEMO_ANLAGE_01";

test("UI-02 draft autosave and restore", async ({ page }) => {
  await page.goto(`/Schichtbuch/${PLANT}`);

  await page.getByTestId("author-name").fill("Playwright User");
  await page.getByTestId("subject").fill("Draft Subject");
  await page.getByTestId("body").fill("Draft Body");

  await page.waitForTimeout(1200);
  await page.reload();

  await expect(page.getByTestId("subject")).toHaveValue("Draft Subject");
  await expect(page.getByTestId("body")).toHaveValue("Draft Body");
});

