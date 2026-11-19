import { defineConfig, devices } from "@playwright/test";
import { readE2EConfiguration } from "./tests/e2e/safety";

const config = readE2EConfiguration(process.env, __dirname);

// 真实服务测试使用已授权登录态和现有服务。
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30 * 60 * 1000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  outputDir: "./output/playwright/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "./output/playwright/report", open: "never" }],
  ],
  use: {
    baseURL: config?.baseURL,
    storageState: config?.authState,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    // 认证请求不能进入 trace/HAR；工程证据只保存指定字段和测试问答。
    trace: "off",
    video: "off",
    screenshot: "off",
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
