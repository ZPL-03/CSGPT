import fs from "node:fs";
import path from "node:path";

import { extractTextFromFile } from "../app/utils/file-text-extractor";
import {
  executeResearchSearch,
  getConfiguredResearchSearchProviders,
  getResearchSearchToolCatalog,
  type ResearchSearchResult,
} from "../app/utils/research-search-registry";
import {
  extractFileIdFromFileUrl,
  uniqueFileIds,
} from "../app/utils/file-context-ids";
import { createResearchSource } from "../app/utils/research-sources";
import {
  buildInternalKnowledgeContext,
  queryKnowledgeGraph,
} from "../app/utils/server-rag-kg";
import type { RagKgDocumentSource } from "../app/utils/rag-kg-sources";

type EvalFailure = {
  suite: string;
  name: string;
  message: string;
};

type EvalResult = {
  suite: string;
  name: string;
  status: "pass" | "skip";
  detail?: string;
};

type CasesFile = {
  ragKg: Array<{
    name: string;
    query: string;
    minDocumentSources: number;
    forbiddenPatterns: string[];
  }>;
  knowledgeGraph: Array<{
    name: string;
    query: string;
    minNodes: number;
    minEdges: number;
  }>;
  fileExtraction: Array<{
    name: string;
    fileName: string;
    mimeType: string;
    content: string;
    expectedIncludes: string[];
    parser: string;
  }>;
  fileContextIds: Array<{
    name: string;
    urls: string[];
    expectedIds: string[];
  }>;
  researchModes: Array<{
    name: string;
    mode: "web" | "academic" | "standard" | "patent";
    provider:
      | "tavily"
      | "semantic-scholar"
      | "elsevier-scopus"
      | "springer-openaccess";
    expectErrorIncludes?: string;
  }>;
  onlineResearch: Array<{
    name: string;
    query: string;
    mode: "web" | "academic" | "standard" | "patent";
    provider: "tavily";
    minResults: number;
  }>;
  databaseMigrations: Array<{
    name: string;
    file: string;
    requiredIncludes: string[];
  }>;
};

const results: EvalResult[] = [];
const failures: EvalFailure[] = [];

function loadCases() {
  const filePath = path.join(
    process.cwd(),
    "evals",
    "csgpt",
    "engineering-cases.json",
  );
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as CasesFile;
}

function loadDotEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line) || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function pass(suite: string, name: string, detail?: string) {
  results.push({ suite, name, status: "pass", detail });
}

function skip(suite: string, name: string, detail?: string) {
  results.push({ suite, name, status: "skip", detail });
}

function fail(suite: string, name: string, message: string) {
  failures.push({ suite, name, message });
}

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoForbiddenText(
  text: string,
  patterns: string[],
  label: string,
) {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, "i");
    assertCondition(!regex.test(text), `${label} 包含禁止内容：${pattern}`);
  }
}

function isDocumentSource(source: unknown): source is RagKgDocumentSource {
  return Boolean(
    source &&
      typeof source === "object" &&
      "kind" in source &&
      source.kind === "document",
  );
}

async function runCase(
  suite: string,
  name: string,
  fn: () => Promise<string | void> | string | void,
) {
  try {
    const detail = await fn();
    pass(suite, name, detail || undefined);
  } catch (error) {
    fail(suite, name, error instanceof Error ? error.message : String(error));
  }
}

async function evaluateRagKg(cases: CasesFile["ragKg"]) {
  for (const item of cases) {
    await runCase("rag-kg", item.name, async () => {
      const context = await buildInternalKnowledgeContext([
        { role: "user", content: item.query },
      ]);
      assertCondition(context, "内部知识库未返回上下文");
      const documentSources = context.sources.filter(isDocumentSource);
      assertCondition(
        documentSources.length >= item.minDocumentSources,
        `文档来源数量 ${documentSources.length} 小于 ${item.minDocumentSources}`,
      );
      assertNoForbiddenText(context.message, item.forbiddenPatterns, "上下文");
      for (const source of documentSources) {
        assertNoForbiddenText(
          source.title,
          item.forbiddenPatterns,
          `来源 ${source.id}`,
        );
      }
      return `sources=${context.sources.length}`;
    });
  }
}

async function evaluateKnowledgeGraph(cases: CasesFile["knowledgeGraph"]) {
  for (const item of cases) {
    await runCase("knowledge-graph", item.name, async () => {
      const graph = await queryKnowledgeGraph(item.query, 40);
      assertCondition(graph.mode === "query", "图谱模式不是 query");
      assertCondition(
        graph.nodes.length >= item.minNodes,
        `节点数量 ${graph.nodes.length} 小于 ${item.minNodes}`,
      );
      assertCondition(
        graph.edges.length >= item.minEdges,
        `关系数量 ${graph.edges.length} 小于 ${item.minEdges}`,
      );
      return `nodes=${graph.nodes.length}, edges=${graph.edges.length}`;
    });
  }
}

async function evaluateFileExtraction(cases: CasesFile["fileExtraction"]) {
  for (const item of cases) {
    await runCase("file-extraction", item.name, async () => {
      const blob = new Blob([item.content], { type: item.mimeType });
      const result = await extractTextFromFile(blob, item.fileName, {
        includeImages: false,
        ocrImages: false,
      });
      for (const expected of item.expectedIncludes) {
        assertCondition(
          result.text.includes(expected),
          `解析文本缺少：${expected}`,
        );
      }
      assertCondition(
        result.metadata.parser === item.parser,
        `parser=${result.metadata.parser}，期望 ${item.parser}`,
      );
      return `parser=${result.metadata.parser}`;
    });
  }
}

async function evaluateFileContextIds(cases: CasesFile["fileContextIds"]) {
  for (const item of cases) {
    await runCase("file-context-ids", item.name, () => {
      const ids = uniqueFileIds(item.urls.map(extractFileIdFromFileUrl));
      assertCondition(
        JSON.stringify(ids) === JSON.stringify(item.expectedIds),
        `fileIds=${JSON.stringify(ids)}，期望 ${JSON.stringify(
          item.expectedIds,
        )}`,
      );
      return `ids=${ids.join(",")}`;
    });
  }
}

async function evaluateResearchModes(cases: CasesFile["researchModes"]) {
  const catalog = getResearchSearchToolCatalog();
  for (const mode of ["web", "academic", "standard", "patent"] as const) {
    assertCondition(catalog.defaults[mode], `缺少默认 Provider：${mode}`);
  }

  for (const item of cases) {
    await runCase("research-mode", item.name, async () => {
      if (item.expectErrorIncludes) {
        try {
          await executeResearchSearch({
            query: "composite pressure vessel",
            mode: item.mode,
            provider: item.provider,
            maxResults: 1,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          assertCondition(
            message.includes(item.expectErrorIncludes),
            `错误信息不包含 ${item.expectErrorIncludes}`,
          );
          return "expected-error";
        }
        throw new Error("未抛出预期错误");
      }

      const provider = catalog.providers.find(
        (entry) => entry.provider === item.provider,
      );
      assertCondition(provider, `Provider 不存在：${item.provider}`);
      assertCondition(
        (provider.modes as readonly string[]).includes(item.mode),
        `${item.provider} 未声明支持 ${item.mode}`,
      );
      return `${item.provider}:${item.mode}`;
    });
  }
}

async function evaluateOnlineResearch(cases: CasesFile["onlineResearch"]) {
  if (process.env.CSGPT_EVAL_ONLINE !== "1") {
    for (const item of cases) {
      skip("online-research", item.name, "设置 CSGPT_EVAL_ONLINE=1 后执行");
    }
    return;
  }

  for (const item of cases) {
    await runCase("online-research", item.name, async () => {
      const result = await executeResearchSearch({
        query: item.query,
        mode: item.mode,
        provider: item.provider,
        maxResults: Math.max(item.minResults, 1),
      });
      assertCondition(
        result.results.length >= item.minResults,
        `结果数量 ${result.results.length} 小于 ${item.minResults}`,
      );
      const source = createResearchSource(result.results[0], 0);
      assertCondition(source.title && source.url, "来源缺少标题或链接");
      return `provider=${result.provider}, results=${result.results.length}`;
    });
  }
}

function isCompositeResearchResult(result: ResearchSearchResult) {
  return /composite|composites|fiber|fibre|polymer|laminate|cfrp|gfrp|carbon|epoxy/i.test(
    [result.title, result.venue, result.source].filter(Boolean).join(" "),
  );
}

async function evaluateOnlineAcademicRelevance() {
  if (process.env.CSGPT_EVAL_ONLINE !== "1") {
    skip(
      "online-research",
      "中文复合材料学术检索相关性",
      "设置 CSGPT_EVAL_ONLINE=1 后执行",
    );
    return;
  }

  await runCase("online-research", "中文复合材料学术检索相关性", async () => {
    const query = "最新的复合材料研究进展有哪些？";
    const providers = getConfiguredResearchSearchProviders("academic");
    const results: ResearchSearchResult[] = [];

    for (const provider of providers) {
      try {
        const search = await executeResearchSearch({
          query,
          mode: "academic",
          provider,
          maxResults: 3,
        });
        results.push(...search.results);
      } catch {
        continue;
      }
    }

    assertCondition(results.length >= 3, `结果数量 ${results.length} 小于 3`);
    const unrelated = results.filter(
      (result) => !isCompositeResearchResult(result),
    );
    assertCondition(
      unrelated.length === 0,
      `存在不相关结果：${unrelated.map((item) => item.title).join("；")}`,
    );
    return `results=${results.length}`;
  });
}

async function evaluateDatabaseMigrations(
  cases: CasesFile["databaseMigrations"],
) {
  for (const item of cases) {
    await runCase("database-migration", item.name, () => {
      const filePath = path.join(process.cwd(), item.file);
      assertCondition(fs.existsSync(filePath), `迁移文件不存在：${item.file}`);
      const sql = fs.readFileSync(filePath, "utf-8");
      for (const required of item.requiredIncludes) {
        assertCondition(
          sql.includes(required),
          `迁移文件缺少内容：${required}`,
        );
      }
      return item.file;
    });
  }
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env"));
  loadDotEnv(path.join(process.cwd(), ".env.local"));

  if (typeof globalThis.atob !== "function") {
    globalThis.atob = (value: string) =>
      Buffer.from(value, "base64").toString("binary");
  }
  if (typeof globalThis.btoa !== "function") {
    globalThis.btoa = (value: string) =>
      Buffer.from(value, "binary").toString("base64");
  }

  const cases = loadCases();
  await evaluateRagKg(cases.ragKg);
  await evaluateKnowledgeGraph(cases.knowledgeGraph);
  await evaluateFileExtraction(cases.fileExtraction);
  await evaluateFileContextIds(cases.fileContextIds);
  await evaluateResearchModes(cases.researchModes);
  await evaluateOnlineResearch(cases.onlineResearch);
  await evaluateOnlineAcademicRelevance();
  await evaluateDatabaseMigrations(cases.databaseMigrations);

  for (const result of results) {
    const detail = result.detail ? ` ${result.detail}` : "";
    console.log(
      `[${result.status}] ${result.suite} :: ${result.name}${detail}`,
    );
  }

  if (failures.length) {
    console.error("");
    for (const failure of failures) {
      console.error(
        `[fail] ${failure.suite} :: ${failure.name} ${failure.message}`,
      );
    }
    process.exit(1);
  }

  const passed = results.filter((result) => result.status === "pass").length;
  const skipped = results.filter((result) => result.status === "skip").length;
  console.log(`CSGPT evaluation passed: ${passed} passed, ${skipped} skipped`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
