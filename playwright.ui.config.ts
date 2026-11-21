import { defineConfig } from "@playwright/test";

const port = Number(process.env.CSGPT_UI_PORT || 3317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("CSGPT_UI_PORT 必须是 1024 到 65535 的整数。");
}
const baseURL = `http://127.0.0.1:${port}`;
const browserChannel =
  process.env.CSGPT_UI_BROWSER_CHANNEL ||
  (process.platform === "win32" ? "msedge" : undefined);

// 兼容测试只启动回环地址上的构建产物，不使用真实账号、数据库或已有服务。
export default defineConfig({
  testDir: "./tests/ui",
  outputDir: "./output/playwright/ui",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    browserName: "chromium",
    channel: browserChannel,
    locale: "zh-CN",
    serviceWorkers: "block",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "node tests/ui/start-server.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      ENABLE_MCP: "false",
      ADMIN_USERNAMES: "",
      DATABASE_URL: "postgresql://compat:compat@127.0.0.1:1/compat",
      JWT_SECRET: "local-ui-compatibility-fixture",
    },
  },
});
