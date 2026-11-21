export const RAG_KG_SOURCES_HEADER = "x-csgpt-rag-kg-sources";

export type RagKgDocumentSource = {
  kind: "document";
  id: string;
  title: string;
  sourceUrl?: string;
  evidence?: RagEvidenceReference;
};

export type RagKgGraphSource = {
  kind: "graph";
  id: string;
  source: string;
  sourceType: string;
  relation: string;
  target: string;
  targetType: string;
  evidence?: RagEvidenceReference;
};

export type RagKgSource = RagKgDocumentSource | RagKgGraphSource;

export type RagKgDocumentGroup = {
  title: string;
  sourceUrl?: string;
  ids: string[];
  evidence: RagEvidenceReference[];
};

function documentIdentity(source: RagKgDocumentSource) {
  const recordId = source.evidence?.record_id?.trim();
  if (recordId) return `record:${recordId}`;
  return `fallback:${source.sourceUrl || ""}\u0000${source.title
    .trim()
    .toLowerCase()}`;
}

/** 将同一来源的多个证据分块合并为一个展示项，保留全部分块编号。 */
export function groupRagKgDocumentSources(
  sources: RagKgDocumentSource[],
): RagKgDocumentGroup[] {
  const groups = new Map<string, RagKgDocumentGroup>();
  for (const source of sources) {
    const key = documentIdentity(source);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        title: source.title,
        sourceUrl: source.sourceUrl,
        ids: [source.id],
        evidence: source.evidence ? [source.evidence] : [],
      });
      continue;
    }
    if (!existing.ids.includes(source.id)) existing.ids.push(source.id);
    if (source.evidence) {
      const duplicate = existing.evidence.some(
        (item) =>
          item.record_id === source.evidence?.record_id &&
          item.chunk_id === source.evidence?.chunk_id &&
          item.chunk_fingerprint === source.evidence?.chunk_fingerprint,
      );
      if (!duplicate) existing.evidence.push(source.evidence);
    }
  }
  return Array.from(groups.values());
}

export function countRagKgDocumentSources(sources: RagKgSource[]) {
  return groupRagKgDocumentSources(
    sources.filter(
      (source): source is RagKgDocumentSource => source.kind === "document",
    ),
  ).length;
}

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
import type { RagEvidenceReference } from "./rag-evidence";
