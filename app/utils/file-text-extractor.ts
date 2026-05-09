/**
 * 上传文件解析工具。
 * 文本接口读取解析文本，多模态接口同时接收原始图片或渲染图片。
 */

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
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

const SPREADSHEET_EXTENSIONS = new Set([
  "csv",
  "tsv",
  "xlsx",
  "xls",
  "xlsm",
  "ods",
]);
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

type FileExtractionInput = string | Blob | ArrayBuffer | Uint8Array;

interface ResolvedFileSource {
  bytes: Uint8Array;
  mimeType: string;
  dataUrl?: string;
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

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
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

async function resolveToFileSource(
  input: FileExtractionInput,
): Promise<ResolvedFileSource> {
  if (typeof input === "string") {
    if (input.startsWith("data:")) {
      return {
        bytes: dataUrlToUint8Array(input),
        mimeType: dataUrlMimeType(input),
        dataUrl: input,
      };
    }
    const response = await fetch(input, {
      mode: "cors",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`文件读取异常：${response.status}`);
    }
    const blob = await response.blob();
    return resolveToFileSource(blob);
  }

  if (input instanceof Uint8Array) {
    return {
      bytes: input,
      mimeType: "application/octet-stream",
    };
  }

  if (input instanceof ArrayBuffer) {
    return {
      bytes: new Uint8Array(input),
      mimeType: "application/octet-stream",
    };
  }

  const bytes = new Uint8Array(await input.arrayBuffer());
  return {
    bytes,
    mimeType: input.type || "application/octet-stream",
  };
}

function cleanText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2")
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
    Math.max(0.25, maxSide / Math.max(image.width, image.height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return dataUrl;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
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
  const preparedImage = await prepareImageForOcr(dataUrl);
  const preparedResult = await worker.recognize(preparedImage);
  const preparedText = cleanText(preparedResult?.data?.text || "");
  if (preparedText.length >= 8 || preparedImage === dataUrl) {
    return preparedText;
  }

  if (dataUrl.length > 3_000_000) {
    return preparedText;
  }

  try {
    const originalResult = await worker.recognize(dataUrl);
    const originalText = cleanText(originalResult?.data?.text || "");
    return originalText.length > preparedText.length
      ? originalText
      : preparedText;
  } catch {
    return preparedText;
  }
}

async function recognizeImages(
  images: string[],
  label: string,
  onProgress?: (completed: number, total: number) => void,
) {
  const sections: string[] = [];
  for (let i = 0; i < images.length; i++) {
    let text = "";
    try {
      text = await recognizeImage(images[i]);
    } catch {
      text = "";
    }
    sections.push(
      text
        ? `## ${label} ${i + 1} OCR\n${text}`
        : `## ${label} ${i + 1} OCR\n未提取到可读文本`,
    );
    onProgress?.(i + 1, images.length);
  }
  return sections;
}

function getPdfRenderScale(page: any, preferredScale = 2.2) {
  const viewport = page.getViewport({ scale: 1 });
  const maxPixels = 3_200_000;
  const maxSide = 2200;
  const scaleByPixels = Math.sqrt(
    maxPixels / Math.max(viewport.width * viewport.height, 1),
  );
  const scaleBySide = maxSide / Math.max(viewport.width, viewport.height, 1);
  return Math.max(0.8, Math.min(preferredScale, scaleByPixels, scaleBySide));
}

async function renderPdfPageToImage(page: any, scale = 2.2): Promise<string> {
  if (typeof document === "undefined") {
    return "";
  }

  const viewport = page.getViewport({ scale: getPdfRenderScale(page, scale) });
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
  type PdfTextItem = {
    text: string;
    x: number;
    y: number;
    width: number;
  };

  const items: PdfTextItem[] = ((textContent.items || []) as any[])
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
    .filter((item: PdfTextItem | null): item is PdfTextItem => Boolean(item));

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

function uniqueStrings(values: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function extractZipImages(zip: any, prefix: string) {
  const images: string[] = [];
  const paths = Object.keys(zip.files).filter(
    (path) =>
      path.toLowerCase().startsWith(prefix.toLowerCase()) &&
      IMAGE_EXTENSIONS.has(getExtension(path)),
  );

  for (const path of paths) {
    const media = zip.file(path);
    if (!media) continue;
    const base64 = await media.async("base64");
    images.push(`data:${imageMimeFromPath(path)};base64,${base64}`);
  }

  return images;
}

function nodeLocalName(node: Node) {
  return (node as Element).localName || node.nodeName.split(":").pop() || "";
}

function collectXmlText(node: Element) {
  const textNodes = Array.from(node.getElementsByTagNameNS("*", "t"));
  if (textNodes.length > 0) {
    return cleanText(textNodes.map((item) => item.textContent || "").join(""));
  }

  return cleanText(
    Array.from(node.getElementsByTagName("*"))
      .filter((item) => nodeLocalName(item) === "t")
      .map((item) => item.textContent || "")
      .join(""),
  );
}

function extractDocxXmlTextWithDom(xml: string) {
  if (typeof DOMParser === "undefined") return "";

  const parser = new DOMParser();
  const documentXml = parser.parseFromString(xml, "application/xml");
  const body =
    documentXml.getElementsByTagNameNS("*", "body")[0] ||
    Array.from(documentXml.getElementsByTagName("*")).find(
      (item) => nodeLocalName(item) === "body",
    );
  if (!body) return "";

  const sections: string[] = [];
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const localName = nodeLocalName(element);
    if (localName === "p") {
      const text = collectXmlText(element);
      if (text) sections.push(text);
    } else if (localName === "tbl") {
      const rows = Array.from(element.getElementsByTagNameNS("*", "tr"));
      const tableRows = rows.map((row) =>
        Array.from(row.getElementsByTagNameNS("*", "tc"))
          .map((cell) => collectXmlText(cell))
          .filter(Boolean)
          .join("\t"),
      );
      const tableText = cleanText(tableRows.filter(Boolean).join("\n"));
      if (tableText) sections.push(tableText);
    }
  }

  return cleanText(sections.join("\n"));
}

function extractDocxXmlTextWithRegex(xml: string) {
  const paragraphs = xml.split(/<\/w:p>|<\/p>/i).map((segment) =>
    cleanText(
      Array.from(
        segment.matchAll(/<[^:>]*:?t\b[^>]*>([\s\S]*?)<\/[^:>]*:?t>/gi),
      )
        .map((match) => decodeXmlEntities(match[1]))
        .join(""),
    ),
  );
  return cleanText(paragraphs.filter(Boolean).join("\n"));
}

async function extractDocxXmlText(zip: any) {
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) return "";
  const xml = await documentFile.async("string");
  return extractDocxXmlTextWithDom(xml) || extractDocxXmlTextWithRegex(xml);
}

async function extractTextDocument(bytes: Uint8Array, fileName: string) {
  return {
    text: decodeBytesAsText(bytes),
    images: [] as string[],
    metadata: { parser: "text", fileName },
  };
}

async function extractSpreadsheet(
  bytes: Uint8Array,
  fileName: string,
  options?: Required<FileExtractionOptions>,
) {
  options?.onProgress(20, "解析表格");
  const XLSX = await import("xlsx");
  const ext = getExtension(fileName);
  const isDelimitedText = ext === "csv" || ext === "tsv";
  const arrayBuffer = toExactArrayBuffer(bytes);
  const workbook = XLSX.read(
    isDelimitedText ? decodeBytesAsText(bytes) : arrayBuffer,
    {
      type: isDelimitedText ? "string" : "array",
      cellDates: true,
      cellFormula: true,
      FS: ext === "tsv" ? "\t" : undefined,
    },
  );

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

  let images: string[] = [];
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    images = await extractZipImages(zip, "xl/media/");
  } catch {
    images = [];
  }

  const textSections = [...sheetSections, ...formulaSections];
  if (options?.ocrImages && images.length > 0) {
    textSections.push(
      ...(await recognizeImages(images, "表格图片", (completed, total) => {
        options.onProgress(
          55 + Math.round((completed / total) * 40),
          `识别表格图片 ${completed}/${total}`,
        );
      })),
    );
  }

  const text = cleanText(textSections.join("\n\n"));
  options?.onProgress(100, "表格解析完成");
  return {
    text: text || `[文件: ${fileName}，未提取到可读文本]`,
    images: options?.includeImages ? images : [],
    metadata: {
      parser: isDelimitedText ? ext : "spreadsheet",
      fileName,
      sheetCount: workbook.SheetNames.length,
      sheets: workbook.SheetNames,
      imageCount: images.length,
      ocrImageCount: options?.ocrImages ? images.length : 0,
    },
  };
}

async function extractDocx(
  bytes: Uint8Array,
  fileName: string,
  options: Required<FileExtractionOptions>,
) {
  options.onProgress(10, "读取 DOCX");
  const JSZip = (await import("jszip")).default;
  const arrayBuffer = toExactArrayBuffer(bytes);
  const zip = await JSZip.loadAsync(arrayBuffer);

  options.onProgress(20, "解析 DOCX 文本");
  let html = "";
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      { convertImage: mammoth.images.dataUri },
    );
    html = result.value || "";
  } catch {
    html = "";
  }

  let xmlText = "";
  try {
    xmlText = await extractDocxXmlText(zip);
  } catch {
    xmlText = "";
  }

  const htmlImages: string[] = [];
  const imgRegex = /<img\s+[^>]*src="(data:[^"]+)"/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    htmlImages.push(match[1]);
  }
  const zipImages = await extractZipImages(zip, "word/media/");
  const images = uniqueStrings([...htmlImages, ...zipImages]);

  const htmlText = htmlToStructuredText(html);
  const documentText =
    htmlText.length >= Math.round(xmlText.length * 0.7) ? htmlText : xmlText;
  const textSections = [buildSection("文档文本", documentText)];
  if (options.ocrImages && images.length > 0) {
    textSections.push(
      ...(await recognizeImages(images, "文档图片", (completed, total) => {
        options.onProgress(
          35 + Math.round((completed / total) * 60),
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
      textSource: documentText === htmlText ? "html" : "xml",
    },
  };
}

async function extractPdf(
  bytes: Uint8Array,
  fileName: string,
  options: Required<FileExtractionOptions>,
) {
  options.onProgress(10, "读取 PDF");
  const pdfjsLib = await import("pdfjs-dist");
  const loadingOptions: any = {
    data: new Uint8Array(bytes),
    stopAtErrors: false,
    useSystemFonts: true,
    isEvalSupported: false,
  };

  if (typeof window === "undefined") {
    loadingOptions.disableWorker = true;
  } else if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";
  }

  const loadingTask = pdfjsLib.getDocument(loadingOptions);
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  const pagesNeedingOcr: number[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    let page: any = null;
    let pageText = "";
    try {
      page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      pageText = extractStructuredPdfText(textContent);
    } catch {
      pageText = "";
    } finally {
      page?.cleanup?.();
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
      let page: any = null;
      try {
        page = await pdf.getPage(i);
        const image = await renderPdfPageToImage(page);
        if (image) renderedImages[i - 1] = image;
      } catch {
        renderedImages[i - 1] = "";
      } finally {
        page?.cleanup?.();
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
      let page: any = null;
      try {
        page = await pdf.getPage(pageNumber);
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
      } finally {
        page?.cleanup?.();
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
  pdf.cleanup?.();
  pdf.destroy?.();

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
  bytes: Uint8Array,
  fileName: string,
  options: Required<FileExtractionOptions>,
) {
  options.onProgress(10, "读取 PPTX");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(toExactArrayBuffer(bytes));

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

  const images = await extractZipImages(zip, "ppt/media/");

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
    let text = "";
    try {
      text = await recognizeImage(dataUrl);
    } catch {
      text = "";
    }
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
  fileInput: FileExtractionInput,
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
  const source = await resolveToFileSource(fileInput);
  const mimeType = source.mimeType;
  normalizedOptions.onProgress(5, "识别文件类型");

  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    return extractSpreadsheet(source.bytes, fileName, normalizedOptions);
  }

  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith("text/")) {
    const result = await extractTextDocument(source.bytes, fileName);
    normalizedOptions.onProgress(100, "文本解析完成");
    return {
      ...result,
      metadata: { ...result.metadata, mimeType },
    };
  }

  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith("image/")) {
    return extractImage(
      source.dataUrl || bytesToDataUrl(source.bytes, mimeType),
      fileName,
      normalizedOptions,
    );
  }

  if (ext === "docx") {
    return extractDocx(source.bytes, fileName, normalizedOptions);
  }

  if (ext === "pdf" || mimeType === "application/pdf") {
    return extractPdf(source.bytes, fileName, normalizedOptions);
  }

  if (PRESENTATION_EXTENSIONS.has(ext)) {
    return extractPresentation(source.bytes, fileName, normalizedOptions);
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
