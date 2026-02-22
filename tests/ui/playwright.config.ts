import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:8080";

export default defineConfig({
  testDir: ".",
  timeout: 45000,
  use: {
    baseURL,
    headless: true,
  },
  reporter: [["list"], ["junit", { outputFile: "results.xml" }]],
});
