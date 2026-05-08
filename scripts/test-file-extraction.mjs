// 文件解析测试脚本：验证 docx/PDF 提取逻辑
// 用法：node scripts/test-file-extraction.mjs <file-path>

import { readFileSync } from "fs";
import { extname } from "path";

const filePath = process.argv[2];
if (!filePath) {
  console.error("用法: node scripts/test-file-extraction.mjs <file-path>");
  process.exit(1);
}

const ext = extname(filePath).toLowerCase();
const fileBuffer = readFileSync(filePath);
const base64 = fileBuffer.toString("base64");
const dataUrl = `data:application/octet-stream;base64,${base64}`;

console.log(`文件: ${filePath}`);
console.log(`大小: ${(fileBuffer.length / 1024).toFixed(1)} KB`);
console.log(`类型: ${ext}\n`);

function base64ToUint8Array(b64) {
  const binary = Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function testDocx() {
  const mammoth = await import("mammoth");
  const uint8 = base64ToUint8Array(base64);
  const arrayBuffer = uint8.buffer.slice(
    uint8.byteOffset,
    uint8.byteOffset + uint8.byteLength,
  );

  console.log("=== DOCX 解析测试 ===");

  // 测试 dataUri 方式（新代码）
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    { convertImage: mammoth.images.dataUri },
  );

  const html = result.value || "";
  console.log(`HTML 长度: ${html.length} 字符`);

  // 提取图片
  const images = [];
  const imgRegex = /<img\s+[^>]*src="(data:[^"]+)"/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    images.push(match[1]);
  }
  console.log(`提取图片数: ${images.length}`);
  for (let i = 0; i < images.length; i++) {
    console.log(`  图片 ${i + 1}: ${images[i].substring(0, 80)}... (${(images[i].length / 1024).toFixed(1)} KB)`);
  }

  // 提取文本
  const text = html
    .replace(/<img[^>]*>/g, "[图片]")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  console.log(`提取文本: ${text.substring(0, 300)}...`);
  console.log(`文本长度: ${text.length} 字符`);
  console.log(`警告数: ${(result.warnings || []).length}`);
  if (result.warnings?.length) {
    console.log(`警告详情:`, result.warnings);
  }
}

async function testPdf() {
  console.log("\n=== PDF 解析测试 ===");
  const pdfjsLib = await import("pdfjs-dist");
  const uint8 = base64ToUint8Array(base64);
  const arrayBuffer = uint8.buffer.slice(
    uint8.byteOffset,
    uint8.byteOffset + uint8.byteLength,
  );

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  console.log(`页数: ${pdf.numPages}`);

  let allText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => item.str ?? "")
        .join(" ");
      console.log(`  第 ${i} 页: ${pageText.substring(0, 100)}...`);
      allText += pageText + "\n\n";
    } catch (e) {
      console.error(`  第 ${i} 页解析失败:`, e.message);
    }
  }

  console.log(`总文本长度: ${allText.length} 字符`);
  console.log(`PDF 元数据:`, pdf._pdfInfo ? JSON.stringify(pdf._pdfInfo) : "无");
}

try {
  if (ext === ".docx") {
    await testDocx();
  } else if (ext === ".pdf") {
    await testPdf();
  } else {
    console.log("不支持的文件类型，请使用 .docx 或 .pdf 文件");
  }

  console.log("\n测试完成");
} catch (e) {
  console.error("测试失败:", e);
  process.exit(1);
}
