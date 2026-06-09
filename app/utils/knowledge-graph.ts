import { Path } from "../constant";

const MEANINGLESS_GRAPH_QUERIES = new Set([
  "新的聊天",
  "新对话",
  "未命名对话",
  "默认标题",
  "new chat",
  "untitled",
]);

const MAX_GRAPH_QUERY_LENGTH = 360;

export function normalizeKnowledgeGraphQuery(query: string) {
  const normalized = String(query || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (MEANINGLESS_GRAPH_QUERIES.has(normalized.toLowerCase())) return "";
  return normalized.slice(0, MAX_GRAPH_QUERY_LENGTH);
}

export function hasKnowledgeGraphQuery(query: string) {
  return normalizeKnowledgeGraphQuery(query).length > 0;
}

export function buildKnowledgeGraphPath(query: string) {
  const trimmed = normalizeKnowledgeGraphQuery(query);
  return trimmed
    ? `${Path.KnowledgeGraph}?q=${encodeURIComponent(trimmed)}`
    : Path.KnowledgeGraph;
}
