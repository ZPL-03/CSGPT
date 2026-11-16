export const RAG_KG_SOURCES_HEADER = "x-csgpt-rag-kg-sources";

export type RagKgDocumentSource = {
  kind: "document";
  id: string;
  title: string;
  sourceUrl?: string;
};

export type RagKgGraphSource = {
  kind: "graph";
  id: string;
  source: string;
  sourceType: string;
  relation: string;
  target: string;
  targetType: string;
};

export type RagKgSource = RagKgDocumentSource | RagKgGraphSource;

const MAX_HEADER_VALUE_LENGTH = 7600;

export function ragKgSourcesFitHeader(sources: RagKgSource[]) {
  return (
    encodeURIComponent(JSON.stringify(sources)).length <=
    MAX_HEADER_VALUE_LENGTH
  );
}

export function encodeRagKgSourcesHeader(sources: RagKgSource[]) {
  if (!sources.length) return "";
  if (!ragKgSourcesFitHeader(sources)) {
    throw new Error("知识库来源超出响应头容量。");
  }
  return encodeURIComponent(JSON.stringify(sources));
}

export function parseRagKgSourcesHeader(response?: Response) {
  const value = response?.headers?.get(RAG_KG_SOURCES_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? (parsed as RagKgSource[]) : [];
  } catch {
    return [];
  }
}
