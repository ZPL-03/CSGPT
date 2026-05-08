/**
 * 从各类文件中提取文本内容和内嵌图片。
 * 支持：纯文本文件（.txt/.md/.csv/.json 等）、.docx、.pdf
 * .docx 可提取内嵌图片，.pdf 可将首页渲染为图片供模型识别
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

export interface FileExtractionResult {
  /** 从文件中提取的文本内容 */
  text: string;
  /** 从文件中提取的内嵌图片 data URL */
  images: string[];
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

function dataUrlToText(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return "";
  const base64 = dataUrl.slice(commaIndex + 1);
  try {
    return atob(base64);
  } catch {
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
 * 将 URL（缓存 URL / 服务端文件 URL / data URL）转换为 data URL 字符串。
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

/**
 * 将 PDF 所有页面渲染为图片 data URL，使模型能完整理解文档内容（含图表、公式、图片）
 */
async function renderPdfPagesToImages(dataUrl: string): Promise<string[]> {
  const images: string[] = [];
  try {
    const pdfjsLib = await import("pdfjs-dist");
    const arrayBuffer = dataUrlToUint8Array(dataUrl).buffer;
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });

        // 创建离屏 canvas 渲染页面
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        await page.render({ canvasContext: ctx, viewport }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        console.error(`[FileExtractor] PDF page ${i} render error:`, e);
      }
    }
  } catch (e) {
    console.error("[FileExtractor] PDF render error:", e);
  }
  return images;
}

export async function extractTextFromFile(
  fileUrl: string,
  fileName: string,
): Promise<FileExtractionResult> {
  const ext = getExtension(fileName);
  const dataUrl = await resolveToDataUrl(fileUrl);

  // 纯文本文件：直接从 data URL 解码文本
  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      return { text: dataUrlToText(dataUrl), images: [] };
    } catch {
      return { text: `[文件: ${fileName}，文本解码失败]`, images: [] };
    }
  }

  // .docx：使用 mammoth 提取文本和图片
  if (ext === "docx") {
    try {
      const mammoth = await import("mammoth");
      const arrayBuffer = dataUrlToUint8Array(dataUrl).buffer;

      // 使用 dataUri 转换器将所有图片转为内嵌 data URI，比 imgElement 异步回调更可靠
      const result = await mammoth.convertToHtml(
        { arrayBuffer },
        { convertImage: mammoth.images.dataUri },
      );

      const html = result.value || "";

      // 从 HTML 中提取图片 data URI
      const images: string[] = [];
      const imgRegex = /<img\s+[^>]*src="(data:[^"]+)"/gi;
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        images.push(match[1]);
      }

      // 从 HTML 中提取纯文本
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

      return {
        text: text || `[文件: ${fileName}，未提取到文本内容]`,
        images,
      };
    } catch (e) {
      console.error("[FileExtractor] .docx parsing error:", e);
      return {
        text: `[文件: ${fileName}，.docx 解析失败，请将文件内容粘贴到对话中]`,
        images: [],
      };
    }
  }

  // .pdf：提取文本，同时将前几页渲染为图片
  if (ext === "pdf") {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      // pdfjs-dist v4 在浏览器中需要配置 worker 路径
      if (
        typeof window !== "undefined" &&
        !pdfjsLib.GlobalWorkerOptions.workerSrc
      ) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";
      }
      const arrayBuffer = dataUrlToUint8Array(dataUrl).buffer;
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str ?? "")
            .join(" ");
          pages.push(pageText);
        } catch (pageError) {
          console.error(`[FileExtractor] PDF page ${i} text error:`, pageError);
        }
      }

      // 渲染页面为图片，使模型能识别 PDF 中的图表和图片
      const images = await renderPdfPagesToImages(dataUrl);

      return {
        text: pages.join("\n\n") || `[文件: ${fileName}，未提取到文本内容]`,
        images,
      };
    } catch (e) {
      console.error("[FileExtractor] .pdf parsing error:", e);
      return {
        text: `[文件: ${fileName}，PDF 解析失败，请将文件内容粘贴到对话中]`,
        images: [],
      };
    }
  }

  // 不支持的文件类型
  return {
    text: `[文件: ${fileName}，此文件类型暂不支持文本提取，请将文件内容粘贴到对话中]`,
    images: [],
  };
}
