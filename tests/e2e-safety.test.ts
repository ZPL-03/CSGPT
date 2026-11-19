import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readE2EConfiguration, TestConversationScope } from "./e2e/safety";

test("授权实测接受已有账号，校验身份配置及仓库外登录态", () => {
  const root = mkdtempSync(join(tmpdir(), "csgpt-e2e-safety-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    const external = join(root, "auth.json");
    const internal = join(repo, "auth.json");
    writeFileSync(external, "{}");
    writeFileSync(internal, "{}");
    const env = {
      CSGPT_E2E_AUTHORIZED: "1",
      CSGPT_E2E_BASE_URL: "http://127.0.0.1:3000",
      CSGPT_E2E_AUTH_STATE: external,
      CSGPT_E2E_EXPECTED_USER_ID: "authorized-user",
    };
    assert.equal(readE2EConfiguration({}, repo), undefined);
    assert.equal(readE2EConfiguration(env, repo)?.cleanup, false);
    assert.equal(
      readE2EConfiguration({ ...env, CSGPT_E2E_CLEANUP: "1" }, repo)?.cleanup,
      true,
    );
    assert.throws(() =>
      readE2EConfiguration({ ...env, CSGPT_E2E_AUTH_STATE: internal }, repo),
    );
    assert.throws(() =>
      readE2EConfiguration({ ...env, CSGPT_E2E_EXPECTED_USER_ID: "" }, repo),
    );
    for (const baseURL of [
      "file:///tmp/app",
      "https://user:secret@example.org",
      "https://example.org?token=secret",
      "https://example.org/app",
    ]) {
      assert.throws(() =>
        readE2EConfiguration({ ...env, CSGPT_E2E_BASE_URL: baseURL }, repo),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("会话写入只接受当前测试创建的 ID 和明确测试名称", () => {
  const scope = new TestConversationScope(["existing"], "run-123");
  assert.throws(() => scope.register("existing", "RAG"));
  assert.throws(() => scope.register("../existing", "RAG"));
  const topic = scope.register("new-id", "RAG");
  assert.throws(() => scope.register("new-id", "RAG"));
  assert.equal(
    scope.allowsMutation("POST", "/api/conversations", { id: "new-id", topic }),
    true,
  );
  for (const id of ["existing", "unknown", "", undefined]) {
    assert.equal(
      scope.allowsMutation("POST", "/api/conversations", { id, topic }),
      false,
    );
  }
  assert.equal(
    scope.allowsMutation("POST", "/api/conversations", {
      id: "new-id",
      topic: "普通会话",
    }),
    false,
  );
  assert.equal(
    scope.allowsMutation("PATCH", "/api/conversations/new-id"),
    false,
  );
  assert.equal(
    scope.allowsMutation("DELETE", "/api/conversations/new-id"),
    false,
  );
});

test("清理仅接受已保存测试 ID，禁止全量删除、旧会话及后续写入", () => {
  const scope = new TestConversationScope(["existing"], "run-456");
  const topic = scope.register("test-id", "ABD");
  assert.throws(() => scope.beginCleanup());
  scope.markSaved("test-id");
  scope.beginCleanup();
  assert.equal(
    scope.allowsMutation("DELETE", "/api/conversations/test-id"),
    true,
  );
  for (const path of [
    "/api/conversations",
    "/api/conversations/existing",
    "/api/conversations/unknown",
    "/api/conversations/test-id/..",
  ]) {
    assert.equal(scope.allowsMutation("DELETE", path), false);
  }
  assert.equal(
    scope.allowsMutation("POST", "/api/conversations", {
      id: "test-id",
      topic,
    }),
    false,
  );
  assert.throws(() => scope.register("another", "RAG"));
});
