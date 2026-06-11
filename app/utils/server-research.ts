import {
  executeResearchSearch,
  type ResearchSearchMode,
  type ResearchSearchResult,
} from "./research-search-registry";
import { createResearchSource, type ResearchSource } from "./research-sources";
import {
  lastUserMessageText,
  normalizeServerMessageText,
  type ServerChatMessageLike,
} from "./server-message-content";

type ExternalResearchContext = {
  message: string;
  sources: ResearchSource[];
};

type ResearchContextOptions = {
  webSearchEnabled: boolean;
  academicSearchEnabled: boolean;
};

function trimText(value: string, limit: number) {
  const text = normalizeServerMessageText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}...`;
}

function getResearchContextTitle(mode: ResearchSearchMode) {
  if (mode === "academic") return "学术检索结果";
  if (mode === "standard") return "标准/规范检索结果";
  if (mode === "patent") return "专利检索结果";
  return "联网检索结果";
}

function renderSearchContext(
  mode: ResearchSearchMode,
  results: ResearchSearchResult[],
) {
  if (!results.length) return "";

  const lines = results.map((result, index) => {
    const source = createResearchSource(result, index);
    const parts = [`[${source.id}] ${source.title}`, `链接: ${source.url}`];
    if (source.source) parts.push(`来源: ${source.source}`);
    if (source.authors?.length) {
      parts.push(`作者: ${source.authors.join("，")}`);
    }
    if (source.venue) parts.push(`期刊/会议: ${source.venue}`);
    if (source.year) parts.push(`年份: ${source.year}`);
    if (source.doi) parts.push(`DOI: ${source.doi}`);
    if (typeof source.score === "number") {
      parts.push(`分数: ${Number(source.score.toFixed(3))}`);
    }
    if (result.snippet) parts.push(`摘要: ${trimText(result.snippet, 260)}`);
    return parts.join("\n");
  });

  return [getResearchContextTitle(mode), ...lines].join("\n\n");
}

function mergeSources(results: ResearchSearchResult[]) {
  return results.map((result, index) => createResearchSource(result, index));
}

function getExternalWebSearchModes(query: string): ResearchSearchMode[] {
  const modes: ResearchSearchMode[] = [];
  if (
    /(标准|规范|规程|法规|认证|iso|astm|asme|gb\/t|en\s?\d|dnv|abs|standard|specification|code|regulation)/i.test(
      query,
    )
  ) {
    modes.push("standard");
  }
  if (
    /(专利|发明|申请人|公开号|授权号|patent|invention|applicant|assignee|publication\s+number)/i.test(
      query,
    )
  ) {
    modes.push("patent");
  }
  if (!modes.length) modes.push("web");
  return modes;
}

export async function buildExternalResearchContext(
  messages: ServerChatMessageLike[],
  options: ResearchContextOptions,
): Promise<ExternalResearchContext | null> {
  const query = trimText(lastUserMessageText(messages), 500);
  if (!query) return null;

  const blocks: string[] = [];
  const sources: ResearchSource[] = [];

  if (options.webSearchEnabled) {
    for (const mode of getExternalWebSearchModes(query)) {
      const search = await executeResearchSearch({
        query,
        mode,
        maxResults: 4,
      });
      const modeSources = mergeSources(search.results);
      if (modeSources.length) {
        blocks.push(renderSearchContext(mode, search.results));
        sources.push(...modeSources);
      }
    }
  }

  if (options.academicSearchEnabled) {
    const academicSearch = await executeResearchSearch({
      query,
      mode: "academic",
      maxResults: 5,
    });
    const academicSources = mergeSources(academicSearch.results);
    if (academicSources.length) {
      blocks.push(renderSearchContext("academic", academicSearch.results));
      sources.push(...academicSources);
    }
  }

  if (!blocks.length) return null;

  return {
    message: blocks.join("\n\n"),
    sources,
  };
}
