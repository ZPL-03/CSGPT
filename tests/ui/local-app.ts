import { test as base, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { version as pdfVersion } from "pdfjs-dist/package.json";
import { tableChunk } from "../helpers/rag-fixtures";
import { parseRagEvidenceMetadata } from "../../app/utils/rag-evidence";
import {
  CSGPT_DEFAULT_MODEL,
  CSGPT_MODEL_2,
  CSGPT_MODEL_3,
} from "../../app/constant";

export const modelSources = [
  {
    id: CSGPT_DEFAULT_MODEL,
    displayName: "CS1",
    upstreamModel: "deepseek-v4.1-flash",
  },
  { id: CSGPT_MODEL_2, displayName: "CS2", upstreamModel: "csllm" },
  { id: CSGPT_MODEL_3, displayName: "CS3", upstreamModel: "qwen3-14b-base" },
];

export const engineeringMarkdown = String.raw`刚度为 $A_{11}=135000\,\mathrm{N/mm}$，B 尚未按工况判定。

$$
\begin{bmatrix}N\\M\end{bmatrix}=\begin{bmatrix}A&B\\B&D\end{bmatrix}\begin{bmatrix}\epsilon^0\\\kappa\end{bmatrix}
$$

| 层厚/mm | 层数 |
| --- | --- |
| 0.125 | 60 |

[设置](/#/settings)

~~~mermaid
flowchart LR
  A["$$A_{11}=135000$$"] --> B[ABD]
~~~

~~~mermaid
erDiagram
  MATERIAL ||--o{ LAYER : contains
  LAYER {
    float angle_deg
  }
~~~
`;

interface LocalMessage {
  id: string;
  role: string;
  content: string;
  date: string;
}

interface LocalConversation {
  id: string;
  topic: string;
  messages: LocalMessage[];
  lastUpdate: number;
  maskConfig?: unknown;
}

interface LocalFile {
  name: string;
  size: number;
  bytes: Buffer;
  extractedText: string;
  complete: boolean;
}

interface LocalApp {
  conversations: Map<string, LocalConversation>;
  files: Map<string, LocalFile>;
  unexpectedRequests: string[];
}

export const test = base.extend<{ localApp: LocalApp }>({
  localApp: [
    async ({ context, baseURL }, use) => {
      if (!baseURL || new URL(baseURL).hostname !== "127.0.0.1") {
        throw new Error("兼容测试仅允许回环服务。");
      }
      const app: LocalApp = {
        conversations: new Map(
          [
            ["fixture-a", "兼容验收 A", engineeringMarkdown],
            ["fixture-b", "兼容验收 B", "这是独立会话 B，厚度 7.5 mm。"],
          ].map(([id, topic, content], index) => [
            id,
            {
              id,
              topic,
              lastUpdate: 1_700_000_000_000 - index,
              messages: [
                {
                  id: `${id}-user`,
                  role: "user",
                  content: "检查公式与层序。",
                  date: "2026-11-19",
                },
                {
                  id: `${id}-answer`,
                  role: "assistant",
                  content,
                  date: "2026-11-19",
                },
              ],
            },
          ]),
        ),
        files: new Map(),
        unexpectedRequests: [],
      };
      const errors: string[] = [];
      context.on("page", (page) =>
        page.on("pageerror", (error) => errors.push(error.message)),
      );
      // 测试剪贴板只接收合成样本，不读写系统剪贴板。
      await context.addInitScript((origin) => {
        if (location.origin !== origin) return;
        localStorage.setItem("lang", "cn");
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: async (text: string) => {
              (
                window as unknown as { compatClipboard: string }
              ).compatClipboard = text;
            },
            write: async (items: ClipboardItem[]) => {
              const blob = await items[0].getType("image/png");
              (
                window as unknown as { compatClipboardImage: number[] }
              ).compatClipboardImage = Array.from(
                new Uint8Array(await blob.arrayBuffer()),
              );
            },
          },
          configurable: true,
        });
      }, baseURL);
      const pdfRoot = path.resolve("node_modules/pdfjs-dist");
      const pdfCdn = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfVersion}/`;
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        // 第三方头像使用仓库图像样本，PNG 导出仍经过实际图像嵌入路径。
        if (
          url.origin === "https://fastly.jsdelivr.net" &&
          url.pathname.startsWith("/npm/emoji-datasource-apple/img/") &&
          url.pathname.endsWith(".png")
        ) {
          await route.fulfill({
            body: await readFile("public/favicon.png"),
            contentType: "image/png",
            headers: { "Access-Control-Allow-Origin": "*" },
          });
          return;
        }
        if (request.url().startsWith(pdfCdn)) {
          const file = path.resolve(
            pdfRoot,
            decodeURIComponent(request.url().slice(pdfCdn.length)),
          );
          expect(file.startsWith(pdfRoot + path.sep)).toBeTruthy();
          await route.fulfill({
            body: await readFile(file),
            contentType: file.endsWith(".mjs")
              ? "text/javascript"
              : file.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream",
            headers: { "Access-Control-Allow-Origin": "*" },
          });
          return;
        }
        if (url.origin !== baseURL) {
          // 外部图片和遥测也不出网；模型与数据接口只允许下方内存响应。
          await route.abort("blockedbyclient");
          return;
        }
        const json = (body: unknown) => route.fulfill({ json: body });
        if (
          url.pathname === "/api/auth/login" ||
          url.pathname === "/api/auth/me"
        ) {
          await json({
            token: "compat-fixture-token",
            user: { id: "compat-user", username: "compat-ui" },
          });
        } else if (url.pathname === "/api/config") {
          await json({
            needCode: false,
            hideUserApiKey: false,
            disableFastLink: false,
            csgptModelSources: modelSources,
          });
        } else if (url.pathname === "/api/knowledge-graph") {
          const query = url.searchParams.get("q") || "";
          await json({
            mode: query ? "query" : "overview",
            query,
            nodes: [
              {
                id: "Material:Fixture",
                label: "Fixture",
                type: "Material",
                count: 1,
                degree: 1,
              },
              {
                id: "Property:E1",
                label: "E1",
                type: "Property",
                count: 1,
                degree: 1,
              },
            ],
            edges: [
              {
                id: "fixture-evidence-edge",
                source: "Material:Fixture",
                target: "Property:E1",
                relation: "HAS_PROPERTY",
                recordId: tableChunk.record_id,
                score: 1,
                evidence: {
                  ...parseRagEvidenceMetadata(tableChunk),
                  title: tableChunk.document_title,
                  text: tableChunk.content_markdown,
                },
              },
            ],
            stats: {
              totalEntities: 2,
              totalRelations: 1,
              matchedRelations: 1,
              returnedNodes: 2,
              returnedEdges: 1,
            },
          });
        } else if (url.pathname.endsWith("/models")) {
          await json({ data: [] });
        } else if (url.pathname === "/api/conversations" && method === "GET") {
          await json({
            conversations: [...app.conversations.values()].sort(
              (a, b) => b.lastUpdate - a.lastUpdate,
            ),
          });
        } else if (url.pathname === "/api/conversations" && method === "POST") {
          const body = request.postDataJSON();
          expect(typeof body.id).toBe("string");
          app.conversations.set(body.id, { ...body, maskConfig: body.mask });
          await json({ conversation: app.conversations.get(body.id) });
        } else if (/^\/api\/conversations\/[^/]+$/.test(url.pathname)) {
          const id = url.pathname.split("/").at(-1)!;
          expect(app.conversations.has(id)).toBeTruthy();
          if (method === "GET")
            await json({ conversation: app.conversations.get(id) });
          else if (method === "DELETE") {
            app.conversations.delete(id);
            await json({ success: true });
          } else throw new Error(`未声明的会话请求：${method}`);
        } else if (url.pathname === "/api/files" && method === "POST") {
          const body = request.postDataJSON();
          const id = `fixture-file-${app.files.size + 1}`;
          app.files.set(id, {
            name: body.name,
            size: body.size,
            bytes: Buffer.alloc(0),
            extractedText: "",
            complete: false,
          });
          await json({ code: 0, data: `/api/files/${id}`, chunkSize: 1024 });
        } else if (/^\/api\/files\/[^/]+$/.test(url.pathname)) {
          const id = url.pathname.split("/").at(-1)!;
          const file = app.files.get(id);
          expect(file).toBeTruthy();
          if (method === "PATCH") {
            expect(Number(url.searchParams.get("offset"))).toBe(
              file!.bytes.length,
            );
            file!.bytes = Buffer.concat([
              file!.bytes,
              request.postDataBuffer()!,
            ]);
          } else if (method === "POST") {
            const body = request.postDataJSON();
            if (body.action === "complete")
              expect(file!.bytes.length).toBe(file!.size);
            else if (body.action === "beginExtractedText")
              file!.extractedText = "";
            else if (body.action === "appendExtractedText")
              file!.extractedText += body.chunk;
            else if (body.action === "completeExtractedText")
              file!.complete = true;
            else throw new Error(`未声明的附件动作：${body.action}`);
          } else if (method === "DELETE") app.files.delete(id);
          else throw new Error(`未声明的附件请求：${method}`);
          await json({ code: 0 });
        } else if (
          !url.pathname.startsWith("/api/") &&
          (method === "GET" ||
            (url.pathname === "/" && request.headers()["next-action"]))
        ) {
          await route.continue();
        } else {
          app.unexpectedRequests.push(`${method} ${url.pathname}`);
          await route.fulfill({
            status: 500,
            json: { error: "未声明的测试请求" },
          });
        }
      });
      await use(app);
      expect(app.unexpectedRequests).toEqual([]);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function login(page: Page) {
  await page.goto("/");
  await page.locator('input[type="text"]').fill("compat-ui");
  await page.locator('input[type="password"]').fill("synthetic-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator("#chat-input")).toBeVisible();
}

export async function clipboard(page: Page) {
  return page.evaluate(
    () => (window as unknown as { compatClipboard: string }).compatClipboard,
  );
}
