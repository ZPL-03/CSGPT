import type {
  ResearchSearchMode,
  ResearchSearchProvider,
  ResearchSearchResult,
} from "./research-search-registry";

export const RESEARCH_SOURCES_HEADER = "x-csgpt-research-sources";

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  provider: ResearchSearchProvider;
  mode: ResearchSearchMode;
  source?: string;
  publishedAt?: string;
  year?: number;
  authors?: string[];
  venue?: string;
  doi?: string;
  score?: number;
};

const MAX_HEADER_VALUE_LENGTH = 7600;

export function createResearchSource(
  result: ResearchSearchResult,
  index: number,
) {
  const prefix =
    result.mode === "academic"
      ? "A"
      : result.mode === "standard"
      ? "STD"
      : result.mode === "patent"
      ? "P"
      : "W";
  return {
    id: `${prefix}${index + 1}`,
    title: result.title,
    url: result.url,
    provider: result.provider,
    mode: result.mode,
    source: result.source,
    publishedAt: result.publishedAt,
    year: result.year,
    authors: result.authors,
    venue: result.venue,
    doi: result.doi,
    score: result.score,
  } satisfies ResearchSource;
}

export function encodeResearchSourcesHeader(sources: ResearchSource[]) {
  if (!sources.length) return "";
  const encode = (items: ResearchSource[]) =>
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

export function parseResearchSourcesHeader(response?: Response) {
  const value = response?.headers?.get(RESEARCH_SOURCES_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? (parsed as ResearchSource[]) : [];
  } catch {
    return [];
  }
}
