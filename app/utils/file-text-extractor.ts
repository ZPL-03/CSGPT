/**
 * 上传文件解析工具。
 * 文本接口读取解析文本，多模态接口同时接收原始图片或渲染图片。
 */

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

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
]);

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "ods"]);
const PRESENTATION_EXTENSIONS = new Set(["pptx"]);

export interface FileExtractionResult {
  /** 模型可读取的解析文本 */
  text: string;
  /** 多模态模型可读取的图片 data URL */
  images: string[];
  /** 数据库可保存的解析元数据 */
  metadata: Record<string, any>;
}

export interface FileExtractionOptions {
  /** 是否输出图片 data URL */
  includeImages?: boolean;
  /** 是否对图片、扫描页、文档内图片执行 OCR */
  ocrImages?: boolean;
  /** 解析进度回调，范围 0-100 */
  onProgress?: (progress: number, stage: string) => void;
}

let ocrWorkerPromise: Promise<any> | null = null;

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

function dataUrlMimeType(dataUrl: string): string {
  const match = /^data:([^;,]+)/i.exec(dataUrl);
  return match?.[1]?.toLowerCase() || "application/octet-stream";
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return new Uint8Array(0);
  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  const binary = header.includes(";base64")
    ? atob(payload)
    : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBytesAsText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

function dataUrlToText(dataUrl: string): string {
  return decodeBytesAsText(dataUrlToUint8Array(dataUrl));
}

async function resolveToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url;
  }
  const response = await fetch(url, { mode: "cors", credentials: "include" });
  if (!response.ok) {
    throw new Error(`文件读取异常：${response.status}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function htmlToStructuredText(html: string): string {
  return cleanText(
    html
      .replace(/<img[^>]*>/gi, "[图片]")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"'),
  );
}

function buildSection(title: string, content: string) {
  const text = cleanText(content);
  return text ? `## ${title}\n${text}` : "";
}

async function getOcrWorker() {
  if (typeof window === "undefined") {
    throw new Error("OCR 需要浏览器环境");
  }
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js").then(async ({ createWorker }) => {
      const worker = await createWorker("chi_sim+eng");
      await worker
        .setParameters({
          preserve_interword_spaces: "1",
        })
        .catch(() => {});
      return worker;
    });
  }
  return ocrWorkerPromise;
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function prepareImageForOcr(dataUrl: string) {
  if (typeof document === "undefined") return dataUrl;

  const image = await loadImage(dataUrl);
  const maxSide = 2600;
  const scale = Math.min(
    2.5,
    Math.max(1, maxSide / Math.max(image.width, image.height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return dataUrl;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const gray =
      imageData.data[i] * 0.299 +
      imageData.data[i + 1] * 0.587 +
      imageData.data[i + 2] * 0.114;
    const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    imageData.data[i] = contrast;
    imageData.data[i + 1] = contrast;
    imageData.data[i + 2] = contrast;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

async function recognizeImage(dataUrl: string): Promise<string> {
  const worker = await getOcrWorker();
  const result = await worker.recognize(await prepareImageForOcr(dataUrl));
  return cleanText(result?.data?.text || "");
}

async function recognizeImages(
  images: string[],
  label: string,
  onProgress?: (completed: number, total: number) => void,
) {
  const sections: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const text = await recognizeImage(images[i]);
    sections.push(
      text
        ? `## ${label} ${i + 1} OCR\n${text}`
        : `## ${label} ${i + 1} OCR\n未提取到可读文本`,
    );
    onProgress?.(i + 1, images.length);
  }
  return sections;
}

async function renderPdfPageToImage(page: any, scale = 2.2): Promise<string> {
  if (typeof document === "undefined") {
    return "";
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.9);
}

function extractStructuredPdfText(textContent: any) {
  const items = (textContent.items || [])
    .map((item: any) => {
      const text = String(item.str ?? "").trim();
      if (!text) return null;
      const transform = item.transform || [];
      return {
        text,
        x: Number(transform[4] || 0),
        y: Number(transform[5] || 0),
        width: Number(item.width || 0),
      };
    })
    .filter(Boolean) as Array<{
    text: string;
    x: number;
    y: number;
    width: number;
  }>;

  if (items.length === 0) return "";

  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<typeof items> = [];
  const lineTolerance = 3;

  for (const item of items) {
    const line = lines.find(
      (current) => Math.abs(current[0].y - item.y) <= lineTolerance,
    );
    if (line) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }

  const text = lines
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((item, index, sorted) => {
          if (index === 0) return item.text;
          const previous = sorted[index - 1];
          const gap = item.x - (previous.x + previous.width);
          return `${gap > 12 ? "\t" : " "}${item.text}`;
        })
        .join(""),
    )
    .join("\n");

  return cleanText(text);
}

function shouldOcrPdfPage(pageText: string) {
  const text = cleanText(pageText);
  if (!text) return true;
  const readableChars = Array.from(text).filter((char) =>
    /[\p{Script=Han}A-Za-z0-9]/u.test(char),
  ).length;
  if (readableChars < 30) return true;
  return readableChars / Math.max(text.length, 1) < 0.35;
}

function imageMimeFromPath(path: string) {
  const ext = getExtension(path);
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

async function extractTextDocument(dataUrl: string, fileName: string) {
  return {
    text: dataUrlToText(dataUrl),
    images: [] as string[],
    metadata: { parser: "text", fileName },
  };
}

async function extractSpreadsheet(dataUrl: string, fileName: string) {
  const XLSX = await import("xlsx");
  const arrayBuffer = dataUrlToUint8Array(dataUrl).buffer;
  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellDates: true,
    cellFormula: true,
  });

  const sheetSections: string[] = [];
  const formulaSections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });
    const tableText = rows
      .map((row) => row.map((cell) => String(cell ?? "")).join("\t"))
      .join("\n");
    sheetSections.push(buildSection(`工作表：${sheetName}`, tableText));

    const formulaRows: string[] = [];
    const ref = sheet["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let row = range.s.r; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
          const address = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = sheet[address] as any;
          if (cell?.f) {
            const value = cell.w ?? cell.v ?? "";
            formulaRows.push(`${address}: =${cell.f} => ${value}`);
          }
        }
      }
    }
    if (formulaRows.length > 0) {
      formulaSections.push(
        buildSection(`工作表公式：${sheetName}`, formulaRows.join("\n")),
      );
    }
  }

  const text = cleanText([...sheetSections, ...formulaSections].join("\n\n"));
  return {
    text: text || `[文件: ${fileName}，未提取到可读文本]`,
    images: [] as string[],
    metadata: {
      parser: "spreadsheet",
      fileName,
      sheetCount: workbook.SheetNames.length,
      sheets: workbook.SheetNames,
    },
  };
}

async function extractDocx(
  dataUrl: string,
  fileName: string,
  options: Required<FileExtractionOptions>,
) {
  options.onProgress(15, "解析 DOCX 文本");
  const mammoth = await import("mammoth");
  const arrayBuffer = dataUrlToUint8Array(dataUrl).buffer;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    { convertImage: mammoth.images.dataUri },
  );

  const html = result.value || "";
  const images: string[] = [];
  const imgRegex = /<img\s+[^>]*src="(data:[^"]+)"/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    images.push(match[1]);
  }

  const textSections = [buildSection("文档文本", htmlToStructuredText(html))];
  if (options.ocrImages && images.length > 0) {
    textSections.push(
      ...(await recognizeImages(images, "文档图片", (completed, total) => {
        options.onProgress(
          25 + Math.round((completed / total) * 70),
          `识别文档图片 ${completed}/${total}`,
        );
      })),
    );
  }
  options.onProgress(100, "DOCX 解析完成");

  return {
    text:
      cleanText(textSections.filter(Boolean).join("\n\n")) ||
      `[文件: ${fileName}，未提取到可读文本]`,
    images: options.includeImages ? images : [],
    metadata: {
      parser: "docx",
      fileName,
      imageCount: images.length,
      ocrImageCount: options.ocrImages ? images.length : 0,
    },
  };
}

async function extractPdf(
  dataUrl: string,
  fileName: string,
  options: Required<FileExtractionOptions>,
) {
  options.onProgress(10, "读取 PDF");
  const pdfjsLib = await import("pdfjs-dist");
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
  const pagesNeedingOcr: number[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    let pageText = "";
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      pageText = extractStructuredPdfText(textContent);
    } catch {
      pageText = "";
    }
    if (shouldOcrPdfPage(pageText)) {
      pagesNeedingOcr.push(i);
    }
    pages.push(
      pageText ? `第 ${i} 页\n${pageText}` : `第 ${i} 页\n未提取到可读文本`,
    );
    options.onProgress(
      10 + Math.round((i / pdf.numPages) * 25),
      `提取 PDF 文本 ${i}/${pdf.numPages}`,
    );
  }

  const renderedImages: string[] = [];
  if (options.includeImages) {
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const image = await renderPdfPageToImage(page);
        if (image) renderedImages[i - 1] = image;
      } catch {
        renderedImages[i - 1] = "";
      }
      options.onProgress(
        35 + Math.round((i / pdf.numPages) * 25),
        `渲染 PDF 页面 ${i}/${pdf.numPages}`,
      );
    }
  }

  const textSections = [buildSection("PDF 文本", pages.join("\n\n"))];
  let ocrPageCount = 0;
  if (options.ocrImages && pagesNeedingOcr.length > 0) {
    const ocrSections: string[] = [];
    for (let i = 0; i < pagesNeedingOcr.length; i++) {
      const pageNumber = pagesNeedingOcr[i];
      try {
        const page = await pdf.getPage(pageNumber);
        const image =
          renderedImages[pageNumber - 1] || (await renderPdfPageToImage(page));
        const text = image ? await recognizeImage(image) : "";
        ocrSections.push(
          text
            ? `## PDF 页面 ${pageNumber} OCR\n${text}`
            : `## PDF 页面 ${pageNumber} OCR\n未提取到可读文本`,
        );
      } catch {
        ocrSections.push(`## PDF 页面 ${pageNumber} OCR\n未提取到可读文本`);
      }
      ocrPageCount += 1;
      options.onProgress(
        60 + Math.round(((i + 1) / pagesNeedingOcr.length) * 35),
        `识别 PDF 页面 ${i + 1}/${pagesNeedingOcr.length}`,
      );
    }
    textSections.push(...ocrSections);
  }
  options.onProgress(100, "PDF 解析完成");

  return {
    text:
      cleanText(textSections.filter(Boolean).join("\n\n")) ||
      `[文件: ${fileName}，未提取到可读文本]`,
    images: options.includeImages ? renderedImages : [],
    metadata: {
      parser: "pdf",
      fileName,
      pageCount: pdf.numPages,
      renderedPageCount: renderedImages.filter(Boolean).length,
      ocrPageCount,
    },
  };
}

async function extractPresentation(
  dataUrl: string,
  fileName: string,
  options: Required<FileExtractionOptions>,
) {
  options.onProgress(10, "读取 PPTX");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(dataUrlToUint8Array(dataUrl).buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => {
      const ai = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const bi = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return ai - bi;
    });

  const slideSections: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const file = zip.file(slideFiles[i]);
    if (!file) continue;
    const xml = await file.async("string");
    const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi))
      .map((match) => decodeXmlEntities(match[1]))
      .filter(Boolean);
    slideSections.push(buildSection(`幻灯片 ${i + 1}`, texts.join("\n")));
    options.onProgress(
      10 + Math.round(((i + 1) / slideFiles.length) * 30),
      `提取幻灯片文本 ${i + 1}/${slideFiles.length}`,
    );
  }

  const mediaPaths = Object.keys(zip.files).filter((path) =>
    /^ppt\/media\//i.test(path),
  );
  const images: string[] = [];
  for (const mediaPath of mediaPaths) {
    if (!IMAGE_EXTENSIONS.has(getExtension(mediaPath))) continue;
    const media = zip.file(mediaPath);
    if (!media) continue;
    const base64 = await media.async("base64");
    images.push(`data:${imageMimeFromPath(mediaPath)};base64,${base64}`);
  }

  const textSections = slideSections;
  if (options.ocrImages && images.length > 0) {
    textSections.push(
      ...(await recognizeImages(images, "幻灯片图片", (completed, total) => {
        options.onProgress(
          45 + Math.round((completed / total) * 50),
          `识别幻灯片图片 ${completed}/${total}`,
        );
      })),
    );
  }
  options.onProgress(100, "PPTX 解析完成");

  return {
    text:
      cleanText(textSections.filter(Boolean).join("\n\n")) ||
      `[文件: ${fileName}，未提取到可读文本]`,
    images: options.includeImages ? images : [],
    metadata: {
      parser: "pptx",
      fileName,
      slideCount: slideFiles.length,
      imageCount: images.length,
      ocrImageCount: options.ocrImages ? images.length : 0,
    },
  };
}

async function extractImage(
  dataUrl: string,
  fileName: string,
  options: Required<FileExtractionOptions>,
) {
  const sections: string[] = [];
  if (options.ocrImages) {
    options.onProgress(20, "识别图片");
    const text = await recognizeImage(dataUrl);
    sections.push(
      text ? buildSection("图片 OCR", text) : "## 图片 OCR\n未提取到可读文本",
    );
  }
  options.onProgress(100, "图片解析完成");

  return {
    text:
      cleanText(sections.join("\n\n")) ||
      `[图片: ${fileName}，未提取到可读文本]`,
    images: options.includeImages ? [dataUrl] : [],
    metadata: {
      parser: "image",
      fileName,
      mimeType: dataUrlMimeType(dataUrl),
      ocrImageCount: options.ocrImages ? 1 : 0,
    },
  };
}

export async function extractTextFromFile(
  fileUrl: string,
  fileName: string,
  options: FileExtractionOptions = {},
): Promise<FileExtractionResult> {
  const normalizedOptions: Required<FileExtractionOptions> = {
    includeImages: options.includeImages ?? true,
    ocrImages: options.ocrImages ?? false,
    onProgress: options.onProgress ?? (() => {}),
  };
  const ext = getExtension(fileName);
  normalizedOptions.onProgress(0, "读取文件");
  const dataUrl = await resolveToDataUrl(fileUrl);
  const mimeType = dataUrlMimeType(dataUrl);
  normalizedOptions.onProgress(5, "识别文件类型");

  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith("text/")) {
    const result = await extractTextDocument(dataUrl, fileName);
    normalizedOptions.onProgress(100, "文本解析完成");
    return {
      ...result,
      metadata: { ...result.metadata, mimeType },
    };
  }

  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith("image/")) {
    return extractImage(dataUrl, fileName, normalizedOptions);
  }

  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    normalizedOptions.onProgress(20, "解析表格");
    const result = await extractSpreadsheet(dataUrl, fileName);
    normalizedOptions.onProgress(100, "表格解析完成");
    return result;
  }

  if (ext === "docx") {
    return extractDocx(dataUrl, fileName, normalizedOptions);
  }

  if (ext === "pdf" || mimeType === "application/pdf") {
    return extractPdf(dataUrl, fileName, normalizedOptions);
  }

  if (PRESENTATION_EXTENSIONS.has(ext)) {
    return extractPresentation(dataUrl, fileName, normalizedOptions);
  }

  return {
    text: `[文件: ${fileName}，文件类型 ${mimeType} 未提取到可读文本]`,
    images: [],
    metadata: {
      parser: "binary",
      fileName,
      mimeType,
    },
  };
}
