import {
  lastUserMessageText,
  normalizeServerMessageText,
  type ServerChatMessageLike,
} from "./server-message-content";

export type FileKnowledgeRecord = {
  recordId?: string;
  title: string;
  fallbackTitle?: string;
  text?: string | null;
  fileIds?: string[];
  preChunked?: boolean;
};

export type FileKnowledgeSource = {
  id: string;
  title: string;
  recordId?: string;
  fileIds?: string[];
  score: number;
};

type FileKnowledgeChunk = {
  sourceTitle: string;
  recordId?: string;
  fileIds?: string[];
  text: string;
  score: number;
};

type FileKnowledgeContextOptions = {
  contextTitle: string;
  scopeDescription: string;
  sourcePrefix: string;
};

type FileKnowledgeContext<TSource extends FileKnowledgeSource> = {
  message: string;
  sources: TSource[];
};

export type FileKnowledgeTextChunk = {
  text: string;
  charStart: number;
  charEnd: number;
};

export const FILE_KNOWLEDGE_CHUNK_CHARS = 1200;
export const FILE_KNOWLEDGE_CHUNK_OVERLAP_CHARS = 220;
const FILE_KNOWLEDGE_CONTEXT_CHARS = 16000;
const MAX_VISIBLE_SOURCES = 8;
const MAX_CONTEXT_CHUNKS = 14;
const MAX_CHUNKS_PER_SOURCE = 4;
const DOMAIN_QUERY_TERMS = [
  "复合材料",
  "耐压壳",
  "压力壳",
  "压力容器",
  "外压",
  "内压",
  "静水压力",
  "屈曲",
  "塌陷",
  "爆破",
  "铺层",
  "缠绕",
  "环向",
  "轴向",
  "螺旋",
  "分层",
  "缺陷",
  "敏感性",
  "强度",
  "刚度",
  "稳定性",
  "疲劳",
  "冲击",
  "材料",
  "树脂",
  "纤维",
  "有限元",
  "标准",
  "验证",
];

function fileTitleBaseName(title: string) {
  return title
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[a-z0-9]{1,12}$/i, "")
    .trim()
    .toLowerCase();
}

function isMachineGeneratedTitle(title: string) {
  const baseName = fileTitleBaseName(title);
  if (!baseName) return true;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      baseName,
    )
  ) {
    return true;
  }
  if (/^[0-9a-f]{20,}$/i.test(baseName)) return true;
  if (/^c[a-z0-9]{20,}$/i.test(baseName)) return true;
  return false;
}

function normalizeFileRecord(record: FileKnowledgeRecord) {
  const fallbackTitle = String(record.fallbackTitle || "附件").trim() || "附件";
  const rawTitle = String(record.title || "").trim();
  const title =
    rawTitle && !isMachineGeneratedTitle(rawTitle) ? rawTitle : fallbackTitle;
  const text = String(record.text || "").trim();
  return { title, text };
}

export function splitFileKnowledgeText(text: string): FileKnowledgeTextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: FileKnowledgeTextChunk[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const slice = normalized.slice(cursor, cursor + FILE_KNOWLEDGE_CHUNK_CHARS);
    const breakIndex = Math.max(
      slice.lastIndexOf("\n\n"),
      slice.lastIndexOf("\n"),
      slice.lastIndexOf("。"),
      slice.lastIndexOf("."),
    );
    const end =
      breakIndex > FILE_KNOWLEDGE_CHUNK_CHARS * 0.45
        ? cursor + breakIndex + 1
        : cursor + FILE_KNOWLEDGE_CHUNK_CHARS;
    const rawChunk = normalized.slice(cursor, end);
    const trimmedText = rawChunk.trim();
    if (trimmedText) {
      const leadingWhitespace = rawChunk.length - rawChunk.trimStart().length;
      const trailingWhitespace = rawChunk.length - rawChunk.trimEnd().length;
      chunks.push({
        text: trimmedText,
        charStart: cursor + leadingWhitespace,
        charEnd: end - trailingWhitespace,
      });
    }

    if (end >= normalized.length) break;

    const overlapCursor = Math.max(
      cursor + 1,
      end - FILE_KNOWLEDGE_CHUNK_OVERLAP_CHARS,
    );
    const overlapWindow = normalized.slice(cursor, overlapCursor);
    const overlapBreakIndex = Math.max(
      overlapWindow.lastIndexOf("\n\n"),
      overlapWindow.lastIndexOf("\n"),
      overlapWindow.lastIndexOf("。"),
      overlapWindow.lastIndexOf("."),
    );
    cursor =
      overlapBreakIndex > FILE_KNOWLEDGE_CHUNK_CHARS * 0.55
        ? cursor + overlapBreakIndex + 1
        : overlapCursor;
  }
  return chunks;
}

export function fileKnowledgeQueryTerms(query: string) {
  const normalized = normalizeServerMessageText(query).toLowerCase();
  const asciiTerms =
    normalized.match(/[a-z0-9][a-z0-9_+./-]{2,}/g)?.filter(Boolean) || [];
  const domainTerms = DOMAIN_QUERY_TERMS.filter((term) =>
    normalized.includes(term.toLowerCase()),
  );
  const chineseTerms =
    normalized.match(/[一-龥]{2,}/g)?.flatMap((term) => {
      const terms: string[] = [];
      for (let size = Math.min(6, term.length); size >= 2; size -= 1) {
        for (let index = 0; index + size <= term.length; index += 1) {
          terms.push(term.slice(index, index + size));
        }
      }
      return terms;
    }) || [];

  return Array.from(new Set([...asciiTerms, ...domainTerms, ...chineseTerms]))
    .sort((left, right) => right.length - left.length)
    .slice(0, 120);
}

function scoreChunk(chunk: string, terms: string[]) {
  if (!terms.length) return 0;
  const text = chunk.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) {
      score += Math.min(5, term.length);
    }
  }
  return score;
}

function buildChunks(records: FileKnowledgeRecord[], query: string) {
  const terms = fileKnowledgeQueryTerms(query);
  const chunks: FileKnowledgeChunk[] = [];

  for (const record of records) {
    const { title, text } = normalizeFileRecord(record);
    if (!text) continue;
    const recordChunks = record.preChunked
      ? [{ text, charStart: 0, charEnd: text.length }]
      : splitFileKnowledgeText(text);
    for (const chunk of recordChunks) {
      const score = scoreChunk(`${title}\n${chunk.text}`, terms);
      if (score <= 0) continue;
      chunks.push({
        sourceTitle: title,
        recordId: record.recordId,
        fileIds: record.fileIds,
        text: chunk.text,
        score,
      });
    }
  }

  return chunks.sort((left, right) => right.score - left.score);
}

function renderContext<TSource extends FileKnowledgeSource>(
  chunks: FileKnowledgeChunk[],
  options: FileKnowledgeContextOptions,
  mapSource: (source: FileKnowledgeSource) => TSource,
) {
  const sources: TSource[] = [];
  const sourceIds = new Map<string, string>();
  const sourceChunkCounts = new Map<string, number>();
  const blocks: string[] = [];
  let usedChars = 0;

  for (const chunk of chunks) {
    if (blocks.length >= MAX_CONTEXT_CHUNKS) break;

    const key = `${chunk.recordId || ""}:${chunk.sourceTitle}`;
    let sourceId = sourceIds.get(key);
    if (!sourceId) {
      if (sources.length >= MAX_VISIBLE_SOURCES) continue;
      sourceId = `${options.sourcePrefix}${sources.length + 1}`;
      sourceIds.set(key, sourceId);
      sources.push(
        mapSource({
          id: sourceId,
          title: chunk.sourceTitle,
          recordId: chunk.recordId,
          fileIds: chunk.fileIds,
          score: chunk.score,
        }),
      );
    }

    const sourceChunkCount = sourceChunkCounts.get(sourceId) || 0;
    if (sourceChunkCount >= MAX_CHUNKS_PER_SOURCE) continue;

    const block = [
      `来源 ${sourceId}: ${chunk.sourceTitle}`,
      `内容: ${chunk.text}`,
    ].join("\n");
    if (usedChars + block.length > FILE_KNOWLEDGE_CONTEXT_CHARS) break;
    blocks.push(block);
    usedChars += block.length;
    sourceChunkCounts.set(sourceId, sourceChunkCount + 1);
  }

  if (!blocks.length) return null;

  return {
    message: [options.contextTitle, options.scopeDescription, ...blocks].join(
      "\n\n",
    ),
    sources,
  } satisfies FileKnowledgeContext<TSource>;
}

export function buildFileKnowledgeContext<
  TSource extends FileKnowledgeSource = FileKnowledgeSource,
>(
  messages: ServerChatMessageLike[],
  records: FileKnowledgeRecord[],
  options: FileKnowledgeContextOptions,
  mapSource: (source: FileKnowledgeSource) => TSource = (source) =>
    source as TSource,
) {
  const query = lastUserMessageText(messages);
  if (!query || !records.length) return null;

  const chunks = buildChunks(records, query);
  if (!chunks.length) return null;
  return renderContext(chunks, options, mapSource);
}
