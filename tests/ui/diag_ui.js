const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('console', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('pageerror', err.message));

  await page.goto('http://127.0.0.1:8080/Schichtbuch/MS_DEMO_ANLAGE_01', { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  const html = await page.content();
  console.log('HAS_TESTID_HTML', html.includes('data-testid="author-name"'));
  console.log('INPUT_COUNT', await page.locator('[data-testid="author-name"]').count());
  console.log('TICKET_INPUT_COUNT', await page.locator('input[placeholder="Name"]').count());
  console.log('TITLE', await page.title());

  await browser.close();
})();

