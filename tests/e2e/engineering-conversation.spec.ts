import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import cases from "../../evals/csgpt/conversation-cases.json";
import { CSGPT_MODEL_2, StoreKey } from "../../app/constant";
import { validateDesignContract } from "../../app/utils/design-contract";
import { readE2EConfiguration, TestConversationScope } from "./safety";
import {
  CSGPTDesignArtifactAssembler,
  validateCSGPTDesignArtifact,
  type CSGPTDesignArtifact,
} from "../../app/utils/structured-design";

const config = readE2EConfiguration(process.env, resolve(__dirname, "../.."));
test.skip(
  !config,
  "需要授权实测开关、现有服务地址、仓库外登录态和预期用户 ID。",
);

// 凭据只在浏览器上下文中使用；原有会话仅返回 ID，不进入工程证据。
async function accountSnapshot(page: Page) {
  return page.evaluate(
    async ({ key, expectedUserId }) => {
      const token = JSON.parse(localStorage.getItem(key) || "null")?.state
        ?.token;
      if (!token) throw new Error("浏览器登录态缺失。");
      const headers = { Authorization: `Bearer ${token}` };
      const me = await fetch("/api/auth/me", { headers, cache: "no-store" });
      if (!me.ok) throw new Error(`身份确认失败：HTTP ${me.status}`);
      if ((await me.json()).user?.id !== expectedUserId) {
        throw new Error("登录账号与预期用户 ID 不一致。");
      }
      const list = await fetch("/api/conversations", {
        headers,
        cache: "no-store",
      });
      if (!list.ok) throw new Error(`会话清单读取失败：HTTP ${list.status}`);
      const body = await list.json();
      if (
        !Array.isArray(body.conversations) ||
        body.conversations.some((item: any) => typeof item.id !== "string")
      ) {
        throw new Error("会话清单缺少有效 ID。");
      }
      return body.conversations.map(
        (item: { id: string }) => item.id,
      ) as string[];
    },
    { key: StoreKey.User, expectedUserId: config!.expectedUserId },
  );
}

async function configure(page: Page, rag: boolean) {
  await page.locator("#chat-input").focus();
  await page.getByTestId("chat-settings").click();
  await page.getByLabel("使用全局设置", { exact: true }).uncheck();
  await page
    .getByLabel("模型 (model)", { exact: true })
    .selectOption(`${CSGPT_MODEL_2}@CSGPT`);
  await page.getByLabel("内部知识库", { exact: true }).setChecked(rag);
  await page.getByLabel("会话文件知识", { exact: true }).uncheck();
  await page.getByLabel("用户文件知识", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
}

async function newChat(
  page: Page,
  rag: boolean,
  scope: TestConversationScope,
  label: string,
) {
  await page.goto("/#/new-chat");
  await page.getByRole("button", { name: "直接开始", exact: true }).click();
  await expect(page.locator("#chat-input")).toBeVisible();
  const id = await page
    .getByTestId("chat-session")
    .getAttribute("data-session-id");
  expect(id).toBeTruthy();
  const topic = scope.register(id!, label);
  await page.getByTestId("chat-topic").click();
  await page.getByTestId("chat-topic-input").fill(topic);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect
    .poll(() => scope.records().find((item) => item.id === id)?.saved)
    .toBe(true);
  await configure(page, rag);
}

// 只采集测试问题、消息体、公开来源和工具记录，不保存认证头或浏览器存储。
async function ask(
  page: Page,
  prompt: string,
  evidence: unknown[],
  scope: TestConversationScope,
  expectedArtifact?: CSGPTDesignArtifact,
) {
  await expect(page.getByTestId("chat-session")).toHaveAttribute(
    "data-session-id",
    scope.currentId!,
  );
  const pending = page.waitForResponse(
    (response) => {
      if (
        !new URL(response.url()).pathname.endsWith("/chat/completions") ||
        response.request().method() !== "POST"
      )
        return false;
      const body = response.request().postDataJSON();
      return body?.messages?.at(-1)?.content === prompt;
    },
    { timeout: 300_000 },
  );
  await page.locator("#chat-input").fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await pending;
  const request = response.request().postDataJSON();
  const raw = await response.text();
  const sources = await response.headerValue("x-csgpt-rag-kg-sources");
  evidence.push({
    prompt,
    status: response.status(),
    request: {
      model: request.model,
      messages: request.messages,
      rag: !!request.csgpt_internal_knowledge_enabled,
      max_tokens: request.max_tokens,
      max_completion_tokens: request.max_completion_tokens,
      chat_template_kwargs: request.chat_template_kwargs,
    },
    sources,
    tools: await response.headerValue("x-csgpt-controlled-tools"),
    response: raw,
  });
  expect(response.status()).toBe(200);
  if (expectedArtifact) {
    const carried = request.messages.find(
      (message: any) => message.designArtifact,
    )?.designArtifact;
    expect(validateCSGPTDesignArtifact(carried).result.design_fingerprint).toBe(
      expectedArtifact.result.design_fingerprint,
    );
    expect(carried.result.candidates).toEqual(
      expectedArtifact.result.candidates,
    );
  }
  const assembler = new CSGPTDesignArtifactAssembler();
  let artifact: CSGPTDesignArtifact | undefined;
  let text = "";
  const reasons: unknown[] = [];
  if (request.stream) {
    expect(raw.trimEnd().endsWith("data: [DONE]")).toBe(true);
    for (const event of raw.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      const value = JSON.parse(data);
      expect(value.error).toBeUndefined();
      if (value.csgpt_design_artifact_chunk)
        artifact =
          assembler.accept(value.csgpt_design_artifact_chunk) || artifact;
      text += value.choices?.[0]?.delta?.content || "";
      if (value.choices?.[0]?.finish_reason != null)
        reasons.push(value.choices[0].finish_reason);
    }
  } else {
    const value = JSON.parse(raw);
    expect(value.error).toBeUndefined();
    text = value.choices[0].message.content;
    reasons.push(value.choices[0].finish_reason);
    artifact = value.csgpt_design_artifact;
  }
  expect(reasons).toEqual(["stop"]);
  expect(text.trim().length).toBeGreaterThan(0);
  await expect(page.getByTestId("chat-assistant").last()).toHaveAttribute(
    "data-message-state",
    "complete",
    { timeout: 60_000 },
  );
  if (artifact) validateCSGPTDesignArtifact(artifact);
  await expect
    .poll(() => scope.hasSavedPrompt(scope.currentId!, prompt), {
      timeout: 30_000,
    })
    .toBe(true);
  return { artifact, sources, text };
}

test("登录态页面：RAG对照、50候选、连续追问、重载和ABD", async ({
  page,
}, info: TestInfo) => {
  const runId = `${info.project.name}-${randomUUID()}`;
  const evidence: unknown[] = [];
  const blockedWrites: { method: string; path: string }[] = [];
  const deletedIds: string[] = [];
  let scope: TestConversationScope | undefined;
  let originalCount = 0;
  let status: "running" | "passed" | "failed" = "running";

  // 请求白名单在导航前生效，页面自动同步也不能覆盖原有会话。
  await page.context().route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    const sameOrigin = url.origin === config!.baseURL;
    let body: unknown;
    if (method === "POST" && url.pathname === "/api/conversations") {
      try {
        body = request.postDataJSON();
      } catch {
        blockedWrites.push({ method, path: url.pathname });
        return route.abort("blockedbyclient");
      }
    }
    const allowed =
      sameOrigin &&
      ((method === "POST" && url.pathname === "/api/config") ||
        (method === "POST" &&
          url.pathname === "/api/csgpt/v1/chat/completions" &&
          !!scope?.currentId) ||
        scope?.allowsMutation(method, url.pathname, body));
    if (allowed) return route.continue();
    blockedWrites.push({ method, path: url.pathname });
    await route.abort("blockedbyclient");
  });

  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname !== "/api/conversations" ||
      response.request().method() !== "POST" ||
      response.status() !== 200
    )
      return;
    const body = response.request().postDataJSON();
    if (!scope?.allowsMutation("POST", "/api/conversations", body)) return;
    scope.markSaved(body.id);
    const messages = body.messages;
    if (
      messages?.at(-1)?.role === "assistant" &&
      messages.at(-1).content &&
      !messages.at(-1).isError
    ) {
      const prompt = messages
        .filter((message: any) => message.role === "user")
        .at(-1)?.content;
      if (typeof prompt === "string") scope.markSaved(body.id, prompt);
    }
  });
  try {
    const authenticated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/me",
    );
    await page.goto("/#/new-chat");
    expect((await authenticated).status(), "登录态必须由真实认证接口确认").toBe(
      200,
    );

    const originalIds = await accountSnapshot(page);
    originalCount = originalIds.length;
    scope = new TestConversationScope(originalIds, runId);

    await newChat(page, false, scope, "RAG关闭");
    const plain = await ask(page, cases.theory, evidence, scope);
    expect(plain.sources).toBeNull();
    await newChat(page, true, scope, "RAG开启");
    const rag = await ask(page, cases.theory, evidence, scope);
    expect(
      rag.sources,
      "开启RAG时需有实际来源，不能仅凭开关计为检索成功",
    ).toBeTruthy();

    await newChat(page, true, scope, "候选与ABD");
    const design = await ask(page, cases.design, evidence, scope);
    expect(design.artifact).toBeTruthy();
    const artifact = design.artifact!;
    expect(artifact.generation_mode).toBe("fem_ready_cylindrical_shell");
    expect(artifact.result.candidate_count).toBe(50);
    expect(validateDesignContract(artifact).result.candidates.at(-1)?.candidate_id).toBe("TMP_50");
    expect(design.text).toMatch(/^\|\s*TMP_50\s*\|/m);
    for (const [index, prompt] of cases.followups.entries()) {
      const answer = await ask(page, prompt, evidence, scope, artifact);
      expect(answer.artifact, "解释追问不能重新生成工件").toBeUndefined();
      if (index === 5) {
        await page.reload();
        await expect(page.locator("#chat-input")).toBeVisible();
      }
    }
    await ask(page, cases.abd, evidence, scope, artifact);
    await info.attach("final-answer.png", {
      body: await page.getByTestId("chat-assistant").last().screenshot(),
      contentType: "image/png",
    });
    info.annotations.push({
      type: "semantic-review",
      description:
        "自动检查仅覆盖协议、工件身份和页面终态；理论及工具解释需按证据文件人工复核。",
    });
    expect(blockedWrites, "检测到超出测试会话范围的写请求").toEqual([]);
    if (config!.cleanup) {
      await page.goto("/#/new-chat");
      await accountSnapshot(page);
      scope.beginCleanup();
      for (const record of scope.records()) {
        const path = `/api/conversations/${record.id}`;
        expect(scope.allowsMutation("DELETE", path)).toBe(true);
        const deleted = await page.evaluate(
          async ({ key, path, topic }) => {
            const token = JSON.parse(localStorage.getItem(key) || "null")?.state
              ?.token;
            if (!token) throw new Error("清理时登录态缺失。");
            const headers = { Authorization: `Bearer ${token}` };
            const detail = await fetch(path, { headers, cache: "no-store" });
            if (
              !detail.ok ||
              (await detail.json()).conversation?.topic !== topic
            ) {
              throw new Error("清理目标与测试会话记录不一致。");
            }
            return (await fetch(path, { method: "DELETE", headers })).status;
          },
          { key: StoreKey.User, path, topic: record.topic },
        );
        expect(deleted).toBe(200);
        deletedIds.push(record.id);
      }
      const remainingIds = new Set(await accountSnapshot(page));
      expect(scope.records().some(({ id }) => remainingIds.has(id))).toBe(
        false,
      );
      expect(blockedWrites, "清理阶段存在未授权写请求").toEqual([]);
    }
    status = "passed";
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    // 关闭测试页，避免失败报告自动快照包含侧栏中的原有会话标题。
    await page.close();
    await info.attach("engineering-evidence.json", {
      body: Buffer.from(
        JSON.stringify(
          {
            run_id: runId,
            status,
            identity_confirmed: !!scope,
            original_conversation_count: originalCount,
            test_conversations: scope?.records() || [],
            deleted_conversation_ids: deletedIds,
            blocked_writes: blockedWrites,
            semantic_review: "required",
            exchanges: evidence,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  }
});
