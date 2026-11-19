import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/parsers",
  outputDir: "./output/playwright/parsers",
  workers: 1,
  retries: 0,
  use: {
    browserName: "chromium",
    channel: process.env.CSGPT_PARSER_BROWSER_CHANNEL || undefined,
    headless: true,
    trace: "off",
    video: "off",
    serviceWorkers: "block",
  },
});
