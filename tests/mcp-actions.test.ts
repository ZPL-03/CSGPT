import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { prisma } from "../app/lib/prisma";
import { generateToken } from "../app/lib/auth";
import * as actions from "../app/mcp/actions";

const nextHeaders = createRequire(import.meta.url)("next/headers");
type TestContext = Parameters<NonNullable<Parameters<typeof test>[0]>>[0];
const server = { command: "fixture-only", args: [], status: "paused" as const };
const config = { mcpServers: { fixture: server } };

// 使用内存配置、模拟数据库与进程拦截，测试不能触及部署配置或启动工具。
function setup(
  t: TestContext,
  options: {
    enabled?: boolean;
    cookie?: string;
    username?: string;
    admins?: string;
  } = {},
) {
  const previous = {
    ENABLE_MCP: process.env.ENABLE_MCP,
    ADMIN_USERNAMES: process.env.ADMIN_USERNAMES,
  };
  process.env.ENABLE_MCP = String(options.enabled ?? true);
  process.env.ADMIN_USERNAMES = options.admins ?? "test-admin";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(
    nextHeaders,
    "headers",
    async () => new Headers(options.cookie ? { Cookie: options.cookie } : {}),
  );
  const originalQuery = prisma.user.findUnique;
  const userQuery = t.mock.fn(async () =>
    options.username
      ? { id: "fixture-user", username: options.username }
      : null,
  );
  prisma.user.findUnique = userQuery as unknown as typeof originalQuery;
  t.after(() => {
    prisma.user.findUnique = originalQuery;
  });
  const read = t.mock.method(fs, "readFile", async () =>
    JSON.stringify(config),
  );
  const write = t.mock.method(fs, "writeFile", async () => undefined);
  t.mock.method(fs, "mkdir", async () => undefined);
  const spawn = t.mock.method(childProcess, "spawn", () => {
    throw new Error("测试禁止启动子进程");
  });
  syncBuiltinESMExports();
  return { userQuery, read, write, spawn };
}

const protectedActions = [
  () => actions.getClientsStatus(),
  () => actions.getClientTools("fixture"),
  () => actions.getAvailableClientsCount(),
  () => actions.getAllTools(),
  () => actions.initializeMcpSystem(),
  () => actions.addMcpServer("fixture", server),
  () => actions.pauseMcpServer("fixture"),
  () => actions.resumeMcpServer("fixture"),
  () => actions.removeMcpServer("fixture"),
  () => actions.restartAllClients(),
  () => actions.executeMcpAction("fixture", { method: "tools/call" }),
  () => actions.getMcpConfigFromFile(),
];

for (const scenario of [
  "disabled",
  "anonymous",
  "invalid-token",
  "ordinary-user",
  "deleted-user",
  "empty-admins",
] as const) {
  test(`MCP ${scenario} 在文件或进程操作前拒绝所有 Server Actions`, async (t) => {
    const mocks = setup(t, {
      enabled: scenario !== "disabled",
      admins: scenario === "empty-admins" ? "" : "test-admin",
      cookie:
        scenario === "anonymous"
          ? undefined
          : `token=${
              scenario === "invalid-token"
                ? "invalid"
                : generateToken("fixture-user")
            }`,
      username:
        scenario === "ordinary-user"
          ? "member"
          : scenario === "deleted-user"
          ? undefined
          : "test-admin",
    });
    assert.equal(await actions.isMcpEnabled(), false);
    for (const action of protectedActions) {
      await assert.rejects(action(), /MCP.*管理员权限/);
    }
    assert.equal(mocks.read.mock.callCount(), 0);
    assert.equal(mocks.write.mock.callCount(), 0);
    assert.equal(mocks.spawn.mock.callCount(), 0);
    if (
      ["disabled", "anonymous", "invalid-token", "empty-admins"].includes(
        scenario,
      )
    ) {
      assert.equal(mocks.userQuery.mock.callCount(), 0);
    }
  });
}

test("MCP 管理员沿用 token cookie，可读取配置并保存暂停状态", async (t) => {
  const mocks = setup(t, {
    cookie: `token=${generateToken("fixture-user")}`,
    username: "test-admin",
    admins: "another, test-admin ",
  });
  assert.equal(await actions.isMcpEnabled(), true);
  assert.deepEqual(await actions.getMcpConfigFromFile(), config);
  assert.deepEqual(await actions.getClientsStatus(), {
    fixture: { status: "paused", errorMsg: null },
  });
  assert.equal(await actions.getAvailableClientsCount(), 0);
  assert.deepEqual(await actions.getAllTools(), []);
  assert.equal(await actions.getClientTools("fixture"), null);
  await actions.initializeMcpSystem();
  await actions.addMcpServer("fixture", server);
  assert.equal(mocks.write.mock.callCount(), 1);
  assert.equal(mocks.spawn.mock.callCount(), 0);
  assert.deepEqual(
    JSON.parse(String(mocks.write.mock.calls[0].arguments[1])),
    config,
  );
});

test("MCP 数据库和配置解析异常保持失败", async (t) => {
  const mocks = setup(t, {
    cookie: `token=${generateToken("fixture-user")}`,
    username: "test-admin",
  });
  mocks.read.mock.mockImplementation(async () => "{");
  await assert.rejects(actions.getMcpConfigFromFile(), SyntaxError);
  mocks.read.mock.mockImplementation(async () => {
    throw Object.assign(new Error("permission"), { code: "EACCES" });
  });
  await assert.rejects(actions.getMcpConfigFromFile(), /permission/);
  mocks.read.mock.mockImplementation(async () => {
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  });
  assert.deepEqual(await actions.getMcpConfigFromFile(), { mcpServers: {} });
  mocks.userQuery.mock.mockImplementation(async () => {
    throw new Error("database unavailable");
  });
  await assert.rejects(actions.isMcpEnabled(), /database unavailable/);
  await assert.rejects(
    actions.addMcpServer("fixture", server),
    /database unavailable/,
  );
  assert.equal(mocks.write.mock.callCount(), 0);
  assert.equal(mocks.spawn.mock.callCount(), 0);
});
