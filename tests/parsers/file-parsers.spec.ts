import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import * as XLSX from "xlsx";
import { version as pdfVersion } from "pdfjs-dist/package.json";
import { pdfBytes } from "../helpers/parser-fixtures";

const origin = "http://parser.test";
const pdfCdn = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfVersion}/`;
const pdfRoot = path.resolve("node_modules/pdfjs-dist");

test.beforeEach(async ({ context, page }) => {
  const source = await readFile("app/utils/file-text-extractor.ts", "utf8");
  const extractor = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const assets: Record<string, string> = {
    "/pdf.mjs": "node_modules/pdfjs-dist/build/pdf.mjs",
    "/xlsx.mjs": "node_modules/xlsx/xlsx.mjs",
    "/jszip.min.js": "node_modules/jszip/dist/jszip.min.js",
  };
  // 浏览器使用全新上下文；所有请求只返回当前依赖或内存样本，不访问应用与公网。
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    let body: string | Buffer;
    let contentType = "text/javascript";
    if (url === `${origin}/`) {
      contentType = "text/html";
      body =
        '<!doctype html><meta charset="utf-8"><script src="/jszip.min.js"></script><script type="importmap">{"imports":{"pdfjs-dist":"/pdf.mjs","xlsx":"/xlsx.mjs","jszip":"/jszip-wrapper.js"}}</script>';
    } else if (url === `${origin}/extractor.js`) {
      body = extractor;
    } else if (url === `${origin}/jszip-wrapper.js`) {
      body = "export default globalThis.JSZip;";
    } else if (url.startsWith(origin) && assets[new URL(url).pathname]) {
      body = await readFile(assets[new URL(url).pathname]);
    } else if (url.startsWith(pdfCdn)) {
      const file = path.resolve(
        pdfRoot,
        decodeURIComponent(url.slice(pdfCdn.length)),
      );
      expect(file.startsWith(pdfRoot + path.sep)).toBeTruthy();
      body = await readFile(file);
      if (file.endsWith(".wasm")) contentType = "application/wasm";
      else if (!file.endsWith(".mjs")) contentType = "application/octet-stream";
    } else {
      throw new Error(`解析测试出现未声明请求：${url}`);
    }
    await route.fulfill({
      body,
      contentType,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto(origin);
});

for (const bookType of ["xlsx", "biff8"] as const) {
  test(`浏览器解析 ${bookType} 保留中文、数值和单位`, async ({ page }) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["材料", "E1/GPa"],
        ["T700/环氧", 135],
      ]),
      "材料",
    );
    const bytes = Array.from(
      new Uint8Array(XLSX.write(workbook, { type: "array", bookType })),
    );
    const result = await page.evaluate(
      async ({ bytes, bookType }) => {
        const moduleUrl = "/extractor.js";
        const { extractTextFromFile } = await import(moduleUrl);
        return extractTextFromFile(
          new Uint8Array(bytes),
          bookType === "biff8" ? "fixture.xls" : "fixture.xlsx",
          { includeImages: false, ocrImages: false },
        );
      },
      { bytes, bookType },
    );
    expect(result.metadata.sheetCount).toBe(1);
    expect(result.text).toContain("T700/环氧");
    expect(result.text).toContain("E1/GPa");
    expect(result.text).toContain("135");
  });
}

test("浏览器 PDF worker 提取文本并渲染非空白页面", async ({ page }) => {
  const workerRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(pdfCdn)) workerRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await page.evaluate(async (bytes) => {
    const moduleUrl = "/extractor.js";
    const { extractTextFromFile } = await import(moduleUrl);
    const parsed = await extractTextFromFile(
      new Uint8Array(bytes),
      "fixture.pdf",
      { includeImages: true, ocrImages: false },
    );
    if (parsed.images.length !== 1 || !parsed.images[0])
      throw new Error("PDF 页面未生成图片");
    const image = new Image();
    image.src = parsed.images[0];
    await image.decode();
    document.body.appendChild(image);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] < 128 &&
        pixels[index + 1] < 128 &&
        pixels[index + 2] < 128
      )
        darkPixels++;
    }
    return {
      text: parsed.text,
      metadata: parsed.metadata,
      width: canvas.width,
      height: canvas.height,
      darkPixels,
    };
  }, Array.from(pdfBytes()));
  expect(result.text).toContain("Pressure = 20 MPa; thickness = 7.5 mm");
  expect(result.metadata.renderedPageCount).toBe(1);
  expect(result.width).toBeGreaterThan(400);
  expect(result.height).toBeGreaterThan(200);
  expect(result.darkPixels).toBeGreaterThan(100);
  expect(
    workerRequests.some((url) => url.endsWith("/build/pdf.worker.min.mjs")),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
