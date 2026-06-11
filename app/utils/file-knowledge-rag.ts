import {
  lastUserMessageText,
  normalizeServerMessageText,
  type ServerChatMessageLike,
} from "./server-message-content";

export type FileKnowledgeRecord = {
  recordId?: string;
  title: string;
  text?: string | null;
  fileIds?: string[];
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
const FILE_KNOWLEDGE_CONTEXT_CHARS = 6000;
const MAX_VISIBLE_SOURCES = 6;

function normalizeFileRecord(record: FileKnowledgeRecord) {
  const title = String(record.title || "附件").trim() || "附件";
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
    cursor = end;
  }
  return chunks;
}

function queryTerms(query: string) {
  const normalized = normalizeServerMessageText(query).toLowerCase();
  const asciiTerms =
    normalized.match(/[a-z0-9][a-z0-9_+./-]{2,}/g)?.filter(Boolean) || [];
  const chineseTerms =
    normalized.match(/[\u4e00-\u9fff]{2,}/g)?.flatMap((term) => {
      const terms: string[] = [];
      for (let size = Math.min(6, term.length); size >= 2; size -= 1) {
        for (let index = 0; index + size <= term.length; index += 1) {
          terms.push(term.slice(index, index + size));
        }
      }
      return terms;
    }) || [];

  return Array.from(new Set([...asciiTerms, ...chineseTerms])).slice(0, 80);
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
  const terms = queryTerms(query);
  const chunks: FileKnowledgeChunk[] = [];

  for (const record of records) {
    const { title, text } = normalizeFileRecord(record);
    if (!text) continue;
    for (const chunk of splitFileKnowledgeText(text)) {
      const score = scoreChunk(chunk.text, terms);
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
  const blocks: string[] = [];
  let usedChars = 0;

  for (const chunk of chunks) {
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

    const block = [
      `来源 ${sourceId}: ${chunk.sourceTitle}`,
      `内容: ${chunk.text}`,
    ].join("\n");
    if (usedChars + block.length > FILE_KNOWLEDGE_CONTEXT_CHARS) break;
    blocks.push(block);
    usedChars += block.length;
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
