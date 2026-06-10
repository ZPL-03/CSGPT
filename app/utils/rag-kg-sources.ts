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

export function encodeRagKgSourcesHeader(sources: RagKgSource[]) {
  if (!sources.length) return "";
  const encode = (items: RagKgSource[]) =>
    encodeURIComponent(JSON.stringify(items));

  const encoded = encode(sources);
  if (encoded.length <= MAX_HEADER_VALUE_LENGTH) return encoded;

  for (let count = sources.length; count > 0; count -= 1) {
    const compactEncoded = encode(sources.slice(0, count));
    if (compactEncoded.length <= MAX_HEADER_VALUE_LENGTH) {
      return compactEncoded;
    }
  }
  return "";
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
