import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

// 登录态由已授权账号提供；真实路径检查覆盖符号链接和目录联接。
export function readE2EConfiguration(
  env: Record<string, string | undefined>,
  repositoryRoot: string,
) {
  if (env.CSGPT_E2E_AUTHORIZED !== "1") return undefined;
  const {
    CSGPT_E2E_BASE_URL,
    CSGPT_E2E_AUTH_STATE,
    CSGPT_E2E_EXPECTED_USER_ID,
  } = env;
  if (
    !CSGPT_E2E_BASE_URL ||
    !CSGPT_E2E_AUTH_STATE ||
    !CSGPT_E2E_EXPECTED_USER_ID?.trim()
  ) {
    throw new Error("授权实测需要服务 URL、仓库外登录态文件和预期用户 ID。");
  }
  let url: URL;
  try {
    url = new URL(CSGPT_E2E_BASE_URL);
  } catch {
    throw new Error("服务 URL 格式无效。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("服务 URL 必须是无凭据、查询参数和子路径的 HTTP(S) 入口。");
  }
  const authState = realpathSync(resolve(CSGPT_E2E_AUTH_STATE));
  const location = relative(realpathSync(repositoryRoot), authState);
  if (
    !isAbsolute(location) &&
    location !== ".." &&
    !location.startsWith(`..${sep}`)
  ) {
    throw new Error("登录态文件必须位于仓库外。");
  }
  return {
    baseURL: url.origin,
    authState,
    expectedUserId: CSGPT_E2E_EXPECTED_USER_ID.trim(),
    cleanup: env.CSGPT_E2E_CLEANUP === "1",
  };
}

type TestConversation = { id: string; topic: string; saved: boolean };

// 会话 ID 由真实页面创建；已有 ID 和未登记 ID 始终不进入写入白名单。
export class TestConversationScope {
  private readonly originalIds: Set<string>;
  private readonly created = new Map<string, TestConversation>();
  private readonly savedPrompts = new Map<string, Set<string>>();
  private cleaning = false;
  currentId?: string;

  constructor(
    originalIds: string[],
    private readonly runId: string,
  ) {
    this.originalIds = new Set(originalIds);
  }

  register(id: string, label: string) {
    if (
      !/^[\w-]+$/.test(id) ||
      this.originalIds.has(id) ||
      this.created.has(id)
    ) {
      throw new Error("测试会话 ID 必须由页面独立创建，且不在已有会话中。");
    }
    if (this.cleaning) throw new Error("清理阶段不能登记会话。");
    const topic = `CSGPT验收 ${this.runId} ${label}`;
    this.created.set(id, { id, topic, saved: false });
    this.currentId = id;
    return topic;
  }

  allowsMutation(method: string, pathname: string, body?: any) {
    if (method === "POST" && pathname === "/api/conversations") {
      const created = this.created.get(body?.id);
      return !!created && !this.cleaning && body?.topic === created.topic;
    }
    if (method === "DELETE" && this.cleaning) {
      const id = pathname.match(/^\/api\/conversations\/([\w-]+)$/)?.[1];
      return !!id && this.created.get(id)?.saved === true;
    }
    return false;
  }

  markSaved(id: string, prompt?: string) {
    const created = this.created.get(id);
    if (!created) return;
    created.saved = true;
    if (prompt) {
      const prompts = this.savedPrompts.get(id) || new Set<string>();
      prompts.add(prompt);
      this.savedPrompts.set(id, prompts);
    }
  }

  hasSavedPrompt(id: string, prompt: string) {
    return this.savedPrompts.get(id)?.has(prompt) === true;
  }

  beginCleanup() {
    if (this.records().some((record) => !record.saved)) {
      throw new Error("测试会话保存状态不完整，保留会话供核查。");
    }
    this.cleaning = true;
  }

  records() {
    return Array.from(this.created.values(), (record) => ({ ...record }));
  }
}
