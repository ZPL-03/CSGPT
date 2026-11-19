import {
  test,
  expect,
  login,
  clipboard,
  engineeringMarkdown,
  modelSources,
} from "./local-app";
import * as XLSX from "xlsx";
import type { Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { pdfBytes } from "../helpers/parser-fixtures";
import { tableChunk } from "../helpers/rag-fixtures";

test.beforeEach(async ({ page }) => login(page));

test("模型展示区分当前上游和路由 ID，会话保存恢复仍使用原 ID", async ({
  page,
  localApp,
}, testInfo) => {
  await page.locator('[title^="兼容验收 A"]').click();
  const selector = page.getByTestId("chat-model-selector");
  await expect(selector).toContainText("CS1（当前上游：deepseek-v4.1-flash）");
  await selector.click();
  for (const source of modelSources) {
    await expect(
      page.getByText(
        `${source.displayName}（当前上游：${source.upstreamModel}） (CSGPT)`,
        { exact: true },
      ),
    ).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath("model-sources.png"),
    animations: "disabled",
  });
  await page
    .getByText("CS2（当前上游：csllm） (CSGPT)", { exact: true })
    .click();
  await expect
    .poll(
      () =>
        (localApp.conversations.get("fixture-a")?.maskConfig as any)
          ?.modelConfig?.model,
    )
    .toBe("QWen3-14B-CS2");
  await page.reload();
  await expect(page.getByTestId("chat-model-selector")).toContainText(
    "CS2（当前上游：csllm）",
  );
  await page.goto("/#/settings");
  const setting = page.getByLabel("模型 (model)", { exact: true });
  await expect(setting).toHaveValue("QWen3-14B-CS1@CSGPT");
  await expect(
    setting.locator('option[value="QWen3-14B-CS1@CSGPT"]'),
  ).toHaveText("CS1（当前上游：deepseek-v4.1-flash）");
});

test("知识图谱证据详情显示当前指纹、条件原文和列投影", async ({
  page,
}, testInfo) => {
  await page.goto("/#/knowledge-graph");
  const evidence = page.getByTestId("knowledge-evidence");
  if (testInfo.project.name === "mobile") {
    const region = page.getByRole("region", { name: "知识图谱", exact: true });
    const box = (await region.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + box.height - 30);
    await page.mouse.wheel(0, 800);
    await expect(evidence.locator("summary").first()).toBeInViewport({
      ratio: 1,
    });
  }
  await evidence.locator("summary").first().click();
  await expect(evidence).toContainText(tableChunk.chunk_id);
  await expect(evidence).toContainText(tableChunk.chunk_fingerprint);
  await expect(evidence).toContainText(tableChunk.applicability_context[0]);
  const condition = evidence.getByText(tableChunk.applicability_context[0], {
    exact: true,
  });
  await condition.scrollIntoViewIfNeeded();
  await expect(condition).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("bound-evidence.png") });
  await evidence.getByText("表格列与投影", { exact: true }).click();
  await expect(evidence.locator("pre")).toContainText("source_column_indices");
  await expect(evidence.locator("pre")).toContainText("table_units_missing");
  const width = await evidence.evaluate((element) => ({
    content: element.scrollWidth,
    visible: element.clientWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.visible + 1);
  const body = evidence.locator(":scope > p").last();
  await expect(body).toHaveText(tableChunk.content_markdown);
  await body.scrollIntoViewIfNeeded();
  await expect(body).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: testInfo.outputPath("bound-evidence-end.png"),
  });
});

test("HashRouter 导航、设置、后退前进和深链接刷新", async ({ page }) => {
  await page.locator('a[href="#/settings"]').click();
  await expect(page).toHaveURL(/#\/settings$/);
  await page.getByLabel("主题", { exact: true }).selectOption("dark");
  await expect(page.locator("body")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator("#chat-input")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByLabel("主题", { exact: true })).toHaveValue("dark");
  await page.goForward();
  await expect(page.locator("#chat-input")).toBeVisible();
  await page.goto("/#/settings");
  await page.reload();
  await expect(page.getByLabel("主题", { exact: true })).toHaveValue("dark");
});

test("会话切换、新建、命名保存和 URL 输入命令", async ({ page, localApp }) => {
  await page.locator('[title^="兼容验收 B"]').click();
  await expect(page.getByTestId("chat-session")).toHaveAttribute(
    "data-session-id",
    "fixture-b",
  );
  await expect(page.getByTestId("chat-assistant").last()).toContainText(
    "7.5 mm",
  );
  await page.goto("/#/new-chat");
  await page.getByRole("button", { name: /^直接开始/ }).click();
  const id = await page
    .getByTestId("chat-session")
    .getAttribute("data-session-id");
  expect(id).not.toMatch(/^fixture-/);
  await page.getByTestId("chat-topic").click();
  await page.getByTestId("chat-topic-input").fill("兼容验收新会话");
  await page.getByRole("button", { name: /^确认/ }).click();
  await expect
    .poll(() => localApp.conversations.get(id!)?.topic)
    .toBe("兼容验收新会话");
  const input = "核对 -45° 与 +45°；\\example.invalid/a?x=1&y=2";
  await page.goto(`/#/chat?fill=${encodeURIComponent(input)}`);
  await expect(page.locator("#chat-input")).toHaveValue(input);
  await expect(page).toHaveURL(/#\/chat$/);
  await page.reload();
  await expect(page.getByTestId("chat-topic")).toHaveText("兼容验收新会话");
  expect(localApp.conversations.get("fixture-a")?.topic).toBe("兼容验收 A");
  expect(localApp.conversations.get("fixture-b")?.topic).toBe("兼容验收 B");
});

test("面具分享链接经查询参数创建指定会话", async ({ page }) => {
  await page.goto("/#/masks");
  await page.getByRole("button", { name: /^查看/ }).first().click();
  const name = await page.getByLabel("角色名称", { exact: true }).inputValue();
  await page.getByRole("button", { name: "分享此面具", exact: true }).click();
  const link = await clipboard(page);
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#\/new-chat\?mask=.+/);
  await page.goto(link);
  await expect(page).toHaveURL(/#\/chat$/);
  await expect(page.getByTestId("chat-topic")).toHaveText(name);
  await expect(page.locator("#chat-input")).toBeVisible();
});

test("页面公式矩阵、Mermaid 数学标签与 ER 图实际渲染", async ({
  page,
}, testInfo) => {
  await page.locator('[title^="兼容验收 A"]').click();
  const answer = page.getByTestId("chat-assistant");
  await expect(answer.locator(".katex-display")).toHaveCount(1);
  await expect(answer.locator("math mtable")).toHaveCount(3);
  await expect(
    answer.locator("table").filter({ hasText: "层厚/mm" }),
  ).toContainText("0.125");
  await expect(answer.locator(".mermaid svg")).toHaveCount(2);
  await expect(answer.locator(".mermaid svg").nth(0)).toContainText("135000");
  await expect(answer.locator(".mermaid svg").nth(1)).toContainText("MATERIAL");
  const diagrams = await answer.locator(".mermaid svg").all();
  for (const [index, svg] of diagrams.entries()) {
    const box = await svg.boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(30);
    await svg.screenshot({ path: testInfo.outputPath(`diagram-${index}.png`) });
  }
  await answer.locator(".katex-display").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("math-mermaid.png"),
    fullPage: true,
  });
  await answer.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
});

test("聊天导出保留公式源文本和 JSON 消息", async ({ page }) => {
  await page.locator('[title^="兼容验收 A"]').click();
  await page.getByTitle("导出聊天记录", { exact: true }).click();
  const modal = page.locator(".modal-mask");
  await modal.locator("select").selectOption("text");
  await modal.getByRole("button", { name: /预览/ }).click();
  await expect(modal.getByRole("button", { name: /ShareGPT/ })).toHaveCount(0);
  await modal.getByRole("button", { name: /^全部复制/ }).click();
  expect(await clipboard(page)).toContain("A_{11}=135000");
  await modal.getByRole("button", { name: /选取/ }).click();
  await modal.locator("select").selectOption("json");
  await modal.getByRole("button", { name: /预览/ }).click();
  await expect(modal.getByRole("button", { name: /ShareGPT/ })).toHaveCount(0);
  const pending = page.waitForEvent("download");
  await modal.getByRole("button", { name: /^下载文件/ }).click();
  const download = await pending;
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(data.messages).toContainEqual({
    role: "user",
    content: "检查公式与层序。",
  });
  expect(data.messages).toContainEqual({
    role: "assistant",
    content: engineeringMarkdown,
  });
});

async function expectPng(page: Page, bytes: number[]) {
  expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const pixels = await page.evaluate(async (data) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)]));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let index = 0; index < rgba.length; index += 4) {
        if (rgba[index + 3] > 0 && rgba[index] < 128) dark++;
      }
      return { width: canvas.width, height: canvas.height, dark };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, bytes);
  expect(pixels.width).toBeGreaterThan(300);
  expect(pixels.height).toBeGreaterThan(300);
  expect(pixels.dark).toBeGreaterThan(1000);
}

test("本地 PNG 导出与桌面图片复制保留渲染内容，没有远端发布动作", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.locator('[title^="兼容验收 A"]').click();
  await page.getByTitle("导出聊天记录", { exact: true }).click();
  const modal = page.locator(".modal-mask");
  await modal.locator("select").selectOption("image");
  await modal.getByRole("button", { name: /预览/ }).click();
  await expect(modal.locator(".mermaid svg")).toHaveCount(2);
  await expect(modal.getByRole("button", { name: /ShareGPT/ })).toHaveCount(0);
  const brand = modal.getByTestId("export-brand");
  await expect(modal).toContainText(
    "当前模型配置: CS1（当前上游：deepseek-v4.1-flash）",
  );
  await expect(modal).toContainText("路由 ID: QWen3-14B-CS1");
  const logo = await brand.getByRole("img", { name: "CSGPT" }).boundingBox();
  const title = await brand.getByText("CSGPT", { exact: true }).boundingBox();
  expect(logo!.x + logo!.width).toBeLessThanOrEqual(title!.x);
  for (const code of await modal.locator("pre code").all()) {
    const width = await code.evaluate((element) => ({
      content: element.scrollWidth,
      visible: element.clientWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.visible + 1);
  }
  const download = isMobile ? null : page.waitForEvent("download");
  await modal.getByRole("button", { name: /^下载文件/ }).click();
  if (download) {
    const chunks: Buffer[] = [];
    for await (const chunk of (await (await download).createReadStream())!)
      chunks.push(Buffer.from(chunk));
    const png = Buffer.concat(chunks);
    await writeFile(testInfo.outputPath("chat-export.png"), png);
    await expectPng(page, Array.from(png));
    await modal.getByRole("button", { name: /^全部复制/ }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { compatClipboardImage?: number[] })
              .compatClipboardImage?.length ?? 0,
        ),
      )
      .toBeGreaterThan(1000);
    await expectPng(
      page,
      await page.evaluate(
        () =>
          (window as unknown as { compatClipboardImage: number[] })
            .compatClipboardImage,
      ),
    );
  } else {
    const image = page.locator('img[src^="data:image/png"]');
    await expect(image).toBeVisible();
    const url = (await image.getAttribute("src"))!;
    const png = Buffer.from(url.split(",")[1], "base64");
    await writeFile(testInfo.outputPath("chat-export.png"), png);
    await expectPng(page, Array.from(png));
  }
});

test("页面上传 XLS、XLSX 与 PDF，解析数值单位并上传完整字节", async ({
  page,
  localApp,
}) => {
  await page.locator('[title^="兼容验收 A"]').click();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["材料", "E1/GPa"],
      ["T700/环氧", 135],
    ]),
    "材料",
  );
  const files = [
    {
      name: "fixture.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(
        XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      ),
    },
    {
      name: "fixture.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: Buffer.from(
        XLSX.write(workbook, { type: "buffer", bookType: "biff8" }),
      ),
    },
    {
      name: "fixture.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        pdfBytes([
          "Pressure = 20 MPa; thickness = 7.5 mm",
          "Material T700/epoxy; E1 = 135 GPa; plies = 60",
        ]),
      ),
    },
  ];
  const pending = page.waitForEvent("filechooser");
  await page.getByText("添加文件", { exact: true }).locator("..").click();
  await (await pending).setFiles(files);
  await expect
    .poll(
      () => [...localApp.files.values()].filter((file) => file.complete).length,
    )
    .toBe(3);
  for (const input of files) {
    const stored = [...localApp.files.values()].find(
      (file) => file.name === input.name,
    )!;
    expect(stored.bytes.equals(input.buffer)).toBe(true);
    if (input.name.endsWith("pdf"))
      expect(stored.extractedText).toContain(
        "Pressure = 20 MPa; thickness = 7.5 mm",
      );
    else {
      expect(stored.extractedText).toContain("T700/环氧");
      expect(stored.extractedText).toContain("E1/GPa");
      expect(stored.extractedText).toContain("135");
    }
  }
  await expect(page.getByText("解析失败", { exact: true })).toHaveCount(0);
});
