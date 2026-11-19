import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { extractTextFromFile } from "../app/utils/file-text-extractor";
import { pdfBytes } from "./helpers/parser-fixtures";

const textOnly = { includeImages: false, ocrImages: false };

// 所有样本在内存生成，不读取用户附件或写入数据库。
for (const [extension, bookType] of [
  ["xlsx", "xlsx"],
  ["xls", "biff8"],
] as const) {
  test(`${extension} 解析保留中文、数值、单位和工作表`, async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["材料", "E1/GPa", "单层厚度/mm"],
      ["T700/环氧", 135, 0.125],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "材料输入");
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["外压/MPa", 20]]),
      "载荷",
    );
    const bytes = XLSX.write(workbook, { type: "array", bookType });
    const result = await extractTextFromFile(
      bytes,
      `materials.${extension}`,
      textOnly,
    );
    assert.equal(result.metadata.parser, "spreadsheet");
    assert.deepEqual(result.metadata.sheets, ["材料输入", "载荷"]);
    for (const value of [
      "T700/环氧",
      "E1/GPa",
      "135",
      "单层厚度/mm",
      "0.125",
      "外压/MPa",
      "20",
    ]) {
      assert.ok(result.text.includes(value), value);
    }
    assert.deepEqual(result.images, []);
  });
}

test("XLSX 公式与缓存计算值分开保留", async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["层数", "单层厚度/mm", "总厚度/mm"],
    [60, 0.125, 7.5],
  ]);
  sheet.C2.f = "A2*B2";
  XLSX.utils.book_append_sheet(workbook, sheet, "铺层");
  const result = await extractTextFromFile(
    XLSX.write(workbook, { type: "array", bookType: "xlsx" }),
    "laminate.xlsx",
    textOnly,
  );
  assert.match(result.text, /C2: =A2\*B2 => 7\.5/);
  assert.match(result.text, /总厚度\/mm/);
});

test("SheetJS 锁定官方分发 URL 和 tarball 完整性", () => {
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const entry = lock.packages["node_modules/xlsx"];
  assert.equal(entry.version, "0.20.3");
  assert.equal(
    entry.resolved,
    "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  );
  assert.equal(
    entry.integrity,
    "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
  );
});

test("PDF 文本解析保留数值和单位，并可重复释放 worker", async () => {
  for (let index = 0; index < 2; index++) {
    const result = await extractTextFromFile(
      pdfBytes(),
      "pressure.pdf",
      textOnly,
    );
    assert.equal(result.metadata.parser, "pdf");
    assert.equal(result.metadata.pageCount, 1);
    assert.match(result.text, /Pressure = 20 MPa; thickness = 7\.5 mm/);
    assert.deepEqual(result.images, []);
  }
});

test("无效 PDF 返回解析错误", async () => {
  await assert.rejects(
    extractTextFromFile(
      new TextEncoder().encode("not a PDF"),
      "invalid.pdf",
      textOnly,
    ),
    /Invalid PDF/,
  );
});

test("DOCX 解析保留段落中的工程输入", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>材料 T700/环氧，E1 = 135 GPa，单层厚度 0.125 mm。</w:t></w:r></w:p></w:body></w:document>',
  );
  const result = await extractTextFromFile(
    await zip.generateAsync({ type: "uint8array" }),
    "material.docx",
    textOnly,
  );
  assert.equal(result.metadata.parser, "docx");
  assert.match(result.text, /T700\/环氧/);
  assert.match(result.text, /135 GPa/);
  assert.match(result.text, /0\.125 mm/);
});
