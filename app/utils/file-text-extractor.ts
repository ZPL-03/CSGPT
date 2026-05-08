/**
 * 从各类文件中提取文本内容，用于发送给模型。
 * 支持：纯文本文件（.txt/.md/.csv/.json 等）、.docx、.pdf
 */

// 可通过 FileReader 直接读取为文本的文件扩展名
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "py",
  "js",
  "ts",
  "jsx",
  "tsx",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "bat",
  "cmd",
  "ini",
  "cfg",
  "conf",
  "toml",
  "env",
  "c",
  "cpp",
  "h",
  "hpp",
  "java",
  "rs",
  "go",
  "rb",
  "php",
  "sql",
  "r",
  "m",
  "swift",
  "kt",
  "scala",
  "tex",
  "latex",
  "bib",
  "rst",
  "org",
]);

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

function dataUrlToText(dataUrl: string): string {
  // data URL 格式: data:[<mediatype>][;base64],<data>
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return "";
  const base64 = dataUrl.slice(commaIndex + 1);
  try {
    return atob(base64);
  } catch {
    // 非 base64 编码的 data URL（如 data:text/plain,hello）
    return decodeURIComponent(base64);
  }
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return new Uint8Array(0);
  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 将 URL（缓存 URL 或 data URL）转换为 data URL 字符串。
 * 如果已经是 data URL 则直接返回，否则 fetch 后转换。
 */
async function resolveToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url;
  }
  const response = await fetch(url, { mode: "cors", credentials: "include" });
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function extractTextFromFile(
  fileUrl: string,
  fileName: string,
): Promise<string> {
  const ext = getExtension(fileName);
  const dataUrl = await resolveToDataUrl(fileUrl);

  // 纯文本文件：直接从 data URL 解码文本
  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      return dataUrlToText(dataUrl);
    } catch {
      return `[文件: ${fileName}，文本解码失败]`;
    }
  }

  // .docx：使用 mammoth 提取文本
  if (ext === "docx") {
    try {
      const mammoth = await import("mammoth");
      const arrayBuffer = dataUrlToUint8Array(dataUrl).buffer;
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value || `[文件: ${fileName}，未提取到文本内容]`;
    } catch (e) {
      console.error("[FileExtractor] .docx parsing error:", e);
      return `[文件: ${fileName}，.docx 解析失败，请将文件内容粘贴到对话中]`;
    }
  }

  // .pdf：使用 pdfjs-dist 提取文本
  if (ext === "pdf") {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      const arrayBuffer = dataUrlToUint8Array(dataUrl).buffer;
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str ?? "")
          .join(" ");
        pages.push(pageText);
      }
      return pages.join("\n\n") || `[文件: ${fileName}，未提取到文本内容]`;
    } catch (e) {
      console.error("[FileExtractor] .pdf parsing error:", e);
      return `[文件: ${fileName}，PDF 解析失败，请将文件内容粘贴到对话中]`;
    }
  }

  // 不支持的文件类型
  return `[文件: ${fileName}，此文件类型暂不支持文本提取，请将文件内容粘贴到对话中]`;
}
