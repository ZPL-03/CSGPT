import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
  configurable: true,
});
const storeModule = import("../app/store/user");

test("用户资料更新保留认证动作身份且不重复请求", async () => {
  const { useUserStore } = await storeModule;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ user: { id: "A", username: "test" } });
  };
  try {
    useUserStore
      .getState()
      .setAuth("test-token", { id: "A", username: "test" });
    const before = useUserStore.getState();
    await before.fetchUser();
    const after = useUserStore.getState();
    assert.notEqual(before, after);
    assert.equal(before.token, after.token);
    assert.equal(before.fetchUser, after.fetchUser);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    useUserStore.getState().logout();
  }
});

for (const status of [200, 401, 404]) {
  test(`旧认证请求 HTTP ${status} 不覆盖新账号或退出状态`, async () => {
    const { useUserStore } = await storeModule;
    const original = globalThis.fetch;
    let complete!: (response: Response) => void;
    globalThis.fetch = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    try {
      useUserStore
        .getState()
        .setAuth("old-token", { id: "A", username: "old" });
      const pending = useUserStore.getState().fetchUser();
      useUserStore
        .getState()
        .setAuth("new-token", { id: "B", username: "new" });
      complete(
        Response.json({ user: { id: "A", username: "old" } }, { status }),
      );
      await pending;
      assert.equal(useUserStore.getState().user?.id, "B");
      assert.equal(useUserStore.getState().token, "new-token");
      const logoutPending = useUserStore.getState().fetchUser();
      useUserStore.getState().logout();
      complete(
        Response.json({ user: { id: "B", username: "new" } }, { status }),
      );
      await logoutPending;
      assert.equal(useUserStore.getState().isLoggedIn, false);
      assert.equal(useUserStore.getState().user, null);
    } finally {
      globalThis.fetch = original;
      useUserStore.getState().logout();
    }
  });
}
