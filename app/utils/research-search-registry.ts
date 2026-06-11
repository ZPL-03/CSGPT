import { z } from "zod";

export type ResearchSearchProvider =
  | "tavily"
  | "semantic-scholar"
  | "elsevier-scopus"
  | "springer-openaccess";
export type ResearchSearchMode = "web" | "academic" | "standard" | "patent";

export type ResearchSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  provider: ResearchSearchProvider;
  mode: ResearchSearchMode;
  publishedAt?: string;
  year?: number;
  authors?: string[];
  venue?: string;
  doi?: string;
  score?: number;
};

const DEFAULT_WEB_RESULTS = 6;
const DEFAULT_ACADEMIC_RESULTS = 8;
const MAX_RESULTS = 10;
const SEARCH_TIMEOUT_MS = 20000;

const providerDefinitions = [
  {
    provider: "tavily",
    mode: "web",
    modes: ["web", "standard", "patent"],
    title: "Tavily Web Search",
    description: "面向网页、标准规范和专利来源的外部检索。",
    envKeys: ["TAVILY_API_KEY"],
  },
  {
    provider: "semantic-scholar",
    mode: "academic",
    modes: ["academic"],
    title: "Semantic Scholar Academic Search",
    description:
      "面向论文题名、摘要、作者、年份、DOI 和开放 PDF 链接的学术检索。",
    envKeys: [
      "SEMANTIC_SCHOLAR_BASE_URL",
      "SEMANTIC_SCHOLAR_AUTH_MODE",
      "AI4SCHOLAR_API_KEY",
      "SEMANTIC_SCHOLAR_API_KEY",
    ],
  },
  {
    provider: "elsevier-scopus",
    mode: "academic",
    modes: ["academic"],
    title: "Elsevier Scopus Search",
    description: "面向 Scopus 题名、摘要、关键词、DOI 和期刊信息的学术检索。",
    envKeys: ["ELSEVIER_API_KEY", "ELSEVIER_INSTTOKEN"],
  },
  {
    provider: "springer-openaccess",
    mode: "academic",
    modes: ["academic"],
    title: "Springer Nature Open Access Search",
    description:
      "面向 Springer Nature 开放获取论文元数据和 DOI 链接的学术检索。",
    envKeys: ["SPRINGER_OPENACCESS_API_KEY"],
  },
] as const;

const providerPrimaryModes = new Map<
  ResearchSearchProvider,
  ResearchSearchMode
>(
  providerDefinitions.map((definition) => [
    definition.provider,
    definition.mode,
  ]),
);
const providerAllowedModes = new Map<
  ResearchSearchProvider,
  ResearchSearchMode[]
>(
  providerDefinitions.map((definition) => [
    definition.provider,
    [...definition.modes] as ResearchSearchMode[],
  ]),
);

const requestSchema = z.object({
  query: z.string().trim().min(1, "检索词不能为空").max(500, "检索词过长"),
  mode: z.enum(["web", "academic", "standard", "patent"]).optional(),
  provider: z
    .enum([
      "tavily",
      "semantic-scholar",
      "elsevier-scopus",
      "springer-openaccess",
    ])
    .optional(),
  maxResults: z.number().int().min(1).max(MAX_RESULTS).optional(),
  searchDepth: z.enum(["basic", "advanced", "fast", "ultra-fast"]).optional(),
  country: z.string().trim().length(2).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  includeAnswer: z.boolean().optional(),
});

export const RESEARCH_SEARCH_TOOL = {
  name: "run_research_search",
  description:
    "执行联网搜索、标准规范检索、专利检索或学术论文检索，返回标题、来源、链接、时间和摘要。",
};

export class ResearchSearchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchSearchConfigurationError";
  }
}

export class UnsupportedResearchSearchProviderError extends Error {
  constructor(provider: string) {
    super(`不支持的检索 Provider：${provider}`);
    this.name = "UnsupportedResearchSearchProviderError";
  }
}

function hasEnv(key: string) {
  return !!process.env[key]?.trim();
}

function isProviderConfigured(provider: ResearchSearchProvider) {
  switch (provider) {
    case "tavily":
      return hasEnv("TAVILY_API_KEY");
    case "semantic-scholar":
      return isSemanticScholarConfigured();
    case "elsevier-scopus":
      return hasEnv("ELSEVIER_API_KEY");
    case "springer-openaccess":
      return hasEnv("SPRINGER_OPENACCESS_API_KEY");
  }
}

function isSemanticScholarConfigured() {
  const baseUrl =
    process.env.SEMANTIC_SCHOLAR_BASE_URL?.trim() ||
    "https://api.semanticscholar.org/graph/v1";
  const usesAi4Scholar = baseUrl.includes("ai4scholar.net");
  return usesAi4Scholar ? hasEnv("AI4SCHOLAR_API_KEY") : true;
}

function getConfiguredProviders() {
  return providerDefinitions.map(
    ({ provider, mode, modes, title, description, envKeys }) => ({
      provider,
      mode,
      modes,
      title,
      description,
      configured: isProviderConfigured(provider),
      envKeys,
    }),
  );
}

export function getResearchSearchToolCatalog() {
  return {
    tool: RESEARCH_SEARCH_TOOL,
    providers: getConfiguredProviders(),
    defaults: {
      web: resolveDefaultProvider("web"),
      academic: resolveDefaultProvider("academic"),
      standard: resolveDefaultProvider("standard"),
      patent: resolveDefaultProvider("patent"),
      maxResults: {
        web: DEFAULT_WEB_RESULTS,
        academic: DEFAULT_ACADEMIC_RESULTS,
        maximum: MAX_RESULTS,
      },
    },
  };
}

function resolveProvider(
  requestedProvider: ResearchSearchProvider | undefined,
  requestedMode: ResearchSearchMode | undefined,
) {
  if (requestedProvider) {
    const modes = providerAllowedModes.get(requestedProvider);
    if (!modes?.length) {
      throw new UnsupportedResearchSearchProviderError(requestedProvider);
    }
    const mode =
      requestedMode ?? providerPrimaryModes.get(requestedProvider) ?? modes[0];
    if (!modes.includes(mode)) {
      throw new ResearchSearchConfigurationError(
        `${requestedProvider} 不支持 ${mode} 检索。`,
      );
    }
    return { provider: requestedProvider, mode };
  }

  const mode = requestedMode ?? "web";
  const defaultProvider = resolveDefaultProvider(mode);
  return {
    mode,
    provider: defaultProvider,
  } as const;
}

function resolveDefaultProvider(mode: ResearchSearchMode) {
  const candidates: ResearchSearchProvider[] =
    mode === "academic"
      ? ["semantic-scholar", "elsevier-scopus", "springer-openaccess"]
      : ["tavily"];

  return (
    candidates.find((provider) => isProviderConfigured(provider)) ||
    candidates[0]
  );
}

function clampMaxResults(value: number | undefined, mode: ResearchSearchMode) {
  return Math.min(
    Math.max(
      value ??
        (mode === "academic" ? DEFAULT_ACADEMIC_RESULTS : DEFAULT_WEB_RESULTS),
      1,
    ),
    MAX_RESULTS,
  );
}

function normalizeWebMode(mode: ResearchSearchMode | undefined) {
  return mode === "standard" || mode === "patent" ? mode : "web";
}

function buildExternalWebQuery(query: string, mode: ResearchSearchMode) {
  if (mode === "standard") {
    return [
      query,
      "standard specification code regulation ISO ASTM ASME EN GB/T DNV ABS",
    ].join(" ");
  }

  if (mode === "patent") {
    return [query, "patent publication invention applicant assignee"].join(" ");
  }

  return query;
}

function compactString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (Array.isArray(value)) {
    const text = value.map(compactText).filter(Boolean).join(" ");
    return text || undefined;
  }

  if (value && typeof value === "object") {
    const text = Object.values(value)
      .map(compactText)
      .filter(Boolean)
      .join(" ");
    return text || undefined;
  }

  return undefined;
}

function compactNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeUrl(value: unknown) {
  const url = compactString(value);
  if (!url) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    return undefined;
  }
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function firstUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const fromArray = firstUrl(...value);
      if (fromArray) return fromArray;
      continue;
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const fromObject = firstUrl(
        record.value,
        record.url,
        record.href,
        record.link,
      );
      if (fromObject) return fromObject;
      continue;
    }

    const url = normalizeUrl(value);
    if (url) return url;
  }
  return undefined;
}

function normalizeAuthors(value: unknown) {
  const names = Array.isArray(value)
    ? value
        .map((author) => {
          if (typeof author === "string") return compactText(author);
          if (author && typeof author === "object") {
            const record = author as Record<string, unknown>;
            return (
              compactText(record.name) ||
              compactText(record.creator) ||
              compactText(record.fullName)
            );
          }
          return undefined;
        })
        .filter(Boolean)
    : [];

  return names.length ? (names as string[]) : undefined;
}

async function parseJsonResponse(response: Response, provider: string) {
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      response.statusText ||
      "检索服务返回错误";
    throw new Error(`${provider} 检索失败：${response.status} ${detail}`);
  }

  return data;
}

async function fetchSearchProvider(
  provider: string,
  url: string | URL,
  init: RequestInit,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    const reason =
      error?.name === "AbortError"
        ? `请求超过 ${SEARCH_TIMEOUT_MS / 1000} 秒`
        : error?.cause?.code || error?.message || "网络请求失败";
    throw new Error(`${provider} 检索请求失败：${reason}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runTavilySearch(input: z.infer<typeof requestSchema>) {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new ResearchSearchConfigurationError("TAVILY_API_KEY 未配置。");
  }

  const mode = normalizeWebMode(input.mode);
  const maxResults = clampMaxResults(input.maxResults, mode);
  const response = await fetchSearchProvider(
    "Tavily",
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: buildExternalWebQuery(input.query, mode),
        search_depth: input.searchDepth ?? "basic",
        max_results: maxResults,
        include_answer: input.includeAnswer ?? false,
        include_raw_content: false,
        topic: "general",
      }),
    },
  );
  const data = await parseJsonResponse(response, "Tavily");

  const results: ResearchSearchResult[] = (
    Array.isArray(data?.results) ? data.results : []
  )
    .map((item: any) => {
      const url = normalizeUrl(item?.url);
      const title = compactString(item?.title) || url;
      if (!url || !title) return null;
      return {
        title,
        url,
        snippet: compactString(item?.content),
        source: hostFromUrl(url),
        provider: "tavily" as const,
        mode,
        publishedAt: compactString(item?.published_date),
        score: typeof item?.score === "number" ? item.score : undefined,
      };
    })
    .filter(Boolean);

  return {
    provider: "tavily" as const,
    mode,
    query: input.query,
    answer: compactString(data?.answer),
    results,
  };
}

function getSemanticScholarHeaders() {
  const key =
    process.env.AI4SCHOLAR_API_KEY?.trim() ||
    process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  const authMode =
    process.env.SEMANTIC_SCHOLAR_AUTH_MODE?.trim() || "x-api-key";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "CSGPT/1.0",
  };

  if (!key) return headers;
  if (authMode === "bearer") {
    headers.Authorization = `Bearer ${key}`;
  } else {
    headers["x-api-key"] = key;
  }

  return headers;
}

async function runSemanticScholarSearch(input: z.infer<typeof requestSchema>) {
  const baseUrl =
    process.env.SEMANTIC_SCHOLAR_BASE_URL?.trim() ||
    "https://api.semanticscholar.org/graph/v1";
  const maxResults = clampMaxResults(input.maxResults, "academic");
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/paper/search`);
  url.searchParams.set("query", input.query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set(
    "fields",
    [
      "title",
      "url",
      "abstract",
      "year",
      "authors",
      "venue",
      "citationCount",
      "openAccessPdf",
      "externalIds",
      "publicationDate",
    ].join(","),
  );

  const response = await fetchSearchProvider("Semantic Scholar", url, {
    headers: getSemanticScholarHeaders(),
  });
  const data = await parseJsonResponse(response, "Semantic Scholar");

  const results: ResearchSearchResult[] = (
    Array.isArray(data?.data) ? data.data : []
  )
    .map((paper: any) => {
      const doi = compactString(paper?.externalIds?.DOI);
      const url =
        normalizeUrl(paper?.openAccessPdf?.url) ||
        normalizeUrl(paper?.url) ||
        (doi ? `https://doi.org/${doi}` : undefined);
      const title = compactString(paper?.title);
      if (!url || !title) return null;
      return {
        title,
        url,
        snippet: compactString(paper?.abstract),
        source: compactString(paper?.venue) || hostFromUrl(url),
        provider: "semantic-scholar" as const,
        mode: "academic" as const,
        publishedAt: compactString(paper?.publicationDate),
        year: typeof paper?.year === "number" ? paper.year : undefined,
        authors: Array.isArray(paper?.authors)
          ? paper.authors
              .map((author: any) => compactString(author?.name))
              .filter(Boolean)
          : undefined,
        venue: compactString(paper?.venue),
        doi,
        score:
          typeof paper?.citationCount === "number"
            ? paper.citationCount
            : undefined,
      };
    })
    .filter(Boolean);

  return {
    provider: "semantic-scholar" as const,
    mode: "academic" as const,
    query: input.query,
    results,
  };
}

function normalizeScopusQuery(query: string) {
  const text = query
    .replace(/[(){}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^[A-Z-]+\(/i.test(text)) return text;
  return `TITLE-ABS-KEY(${text})`;
}

async function runElsevierScopusSearch(input: z.infer<typeof requestSchema>) {
  const apiKey = process.env.ELSEVIER_API_KEY?.trim();
  if (!apiKey) {
    throw new ResearchSearchConfigurationError("ELSEVIER_API_KEY 未配置。");
  }

  const maxResults = clampMaxResults(input.maxResults, "academic");
  const url = new URL("https://api.elsevier.com/content/search/scopus");
  url.searchParams.set("query", normalizeScopusQuery(input.query));
  url.searchParams.set("count", String(maxResults));

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "CSGPT/1.0",
    "X-ELS-APIKey": apiKey,
  };
  const instToken = process.env.ELSEVIER_INSTTOKEN?.trim();
  if (instToken) {
    headers["X-ELS-Insttoken"] = instToken;
  }

  const response = await fetchSearchProvider("Elsevier Scopus", url, {
    headers,
  });
  const data = await parseJsonResponse(response, "Elsevier Scopus");

  const results: ResearchSearchResult[] = (
    Array.isArray(data?.["search-results"]?.entry)
      ? data["search-results"].entry
      : []
  )
    .map((entry: any) => {
      const doi = compactString(entry?.["prism:doi"]);
      const url =
        firstUrl(entry?.["prism:url"], entry?.link) ||
        (doi ? `https://doi.org/${doi}` : undefined);
      const title = compactText(entry?.["dc:title"]);
      if (!url || !title) return null;
      const year = compactString(entry?.["prism:coverDate"])?.match(/^\d{4}/);
      return {
        title,
        url,
        source:
          compactText(entry?.["prism:publicationName"]) || hostFromUrl(url),
        provider: "elsevier-scopus" as const,
        mode: "academic" as const,
        publishedAt: compactString(entry?.["prism:coverDate"]),
        year: year ? Number(year[0]) : undefined,
        authors: normalizeAuthors([entry?.["dc:creator"]]),
        venue: compactText(entry?.["prism:publicationName"]),
        doi,
        score: compactNumber(entry?.["citedby-count"]),
      };
    })
    .filter(Boolean);

  return {
    provider: "elsevier-scopus" as const,
    mode: "academic" as const,
    query: input.query,
    results,
  };
}

async function runSpringerOpenAccessSearch(
  input: z.infer<typeof requestSchema>,
) {
  const apiKey = process.env.SPRINGER_OPENACCESS_API_KEY?.trim();
  if (!apiKey) {
    throw new ResearchSearchConfigurationError(
      "SPRINGER_OPENACCESS_API_KEY 未配置。",
    );
  }

  const maxResults = clampMaxResults(input.maxResults, "academic");
  const url = new URL("https://api.springernature.com/openaccess/json");
  url.searchParams.set("q", input.query);
  url.searchParams.set("p", String(maxResults));
  url.searchParams.set("api_key", apiKey);

  const response = await fetchSearchProvider(
    "Springer Nature Open Access",
    url,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "CSGPT/1.0",
      },
    },
  );
  const data = await parseJsonResponse(response, "Springer Nature Open Access");

  const results: ResearchSearchResult[] = (
    Array.isArray(data?.records) ? data.records : []
  )
    .map((record: any) => {
      const doi = compactString(record?.doi);
      const url =
        firstUrl(record?.url) || (doi ? `https://doi.org/${doi}` : undefined);
      const title = compactText(record?.title);
      if (!url || !title) return null;
      const publishedAt =
        compactString(record?.publicationDate) ||
        compactString(record?.onlineDate) ||
        compactString(record?.coverDate);
      const year = publishedAt?.match(/^\d{4}/);
      return {
        title,
        url,
        snippet: compactText(record?.abstract),
        source: compactText(record?.publicationName) || hostFromUrl(url),
        provider: "springer-openaccess" as const,
        mode: "academic" as const,
        publishedAt,
        year: year ? Number(year[0]) : undefined,
        authors: normalizeAuthors(record?.creators),
        venue: compactText(record?.publicationName),
        doi,
      };
    })
    .filter(Boolean);

  return {
    provider: "springer-openaccess" as const,
    mode: "academic" as const,
    query: input.query,
    results,
  };
}

export async function executeResearchSearch(rawBody: unknown) {
  const input = requestSchema.parse(rawBody);
  const { provider, mode } = resolveProvider(input.provider, input.mode);

  if (!isProviderConfigured(provider)) {
    throw new ResearchSearchConfigurationError(`${provider} 检索服务未配置。`);
  }

  switch (provider) {
    case "tavily":
      return runTavilySearch({ ...input, mode });
    case "semantic-scholar":
      return runSemanticScholarSearch({ ...input, mode });
    case "elsevier-scopus":
      return runElsevierScopusSearch({ ...input, mode });
    case "springer-openaccess":
      return runSpringerOpenAccessSearch({ ...input, mode });
    default:
      throw new UnsupportedResearchSearchProviderError(provider);
  }
}
