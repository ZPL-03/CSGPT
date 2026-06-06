import { Path } from "../constant";

export function buildKnowledgeGraphPath(query: string) {
  const trimmed = query.trim();
  return trimmed
    ? `${Path.KnowledgeGraph}?q=${encodeURIComponent(trimmed)}`
    : Path.KnowledgeGraph;
}
