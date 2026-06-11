import fs from "node:fs";
import path from "node:path";

import { executeDesignCalculation } from "../app/utils/design-calculation-registry";
import { extractTextFromFile } from "../app/utils/file-text-extractor";
import {
  executeResearchSearch,
  getResearchSearchToolCatalog,
} from "../app/utils/research-search-registry";
import {
  extractFileIdFromFileUrl,
  uniqueFileIds,
} from "../app/utils/file-context-ids";
import { createResearchSource } from "../app/utils/research-sources";
import {
  buildControlledAgentPlan,
  planControlledChatTools,
  type ControlledToolAllowList,
} from "../app/utils/server-agent-planner";
import {
  buildExternalRagKgContext,
  queryKnowledgeGraph,
} from "../app/utils/server-rag-kg";
import { buildExternalStructureVisualizationContext } from "../app/utils/server-structure-visualization";
import { buildExternalSimulationJobContext } from "../app/utils/server-simulation-job";
import {
  simulationJobCreateSchema,
  simulationJobUpdateSchema,
} from "../app/utils/simulation-jobs";
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
  planner: Array<{
    name: string;
    message: string;
    allow: ControlledToolAllowList;
    selected: string[];
    unselected: string[];
  }>;
  designCalculations: Array<{
    name: string;
    type: string;
    input: unknown;
    expect: Array<{
      path: string;
      equals?: unknown;
      approx?: number;
      tolerance?: number;
      min?: number;
    }>;
  }>;
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
  structureVisualizations: Array<{
    name: string;
    query: string;
    minVisualizations: number;
    expectedTypes: string[];
  }>;
  simulationJobDrafts: Array<{
    name: string;
    query: string;
    expectedSolver: string;
    expectedOutputs: string[];
    expectedMissingFields: string[];
  }>;
  simulationJobs: Array<{
    name: string;
    create: unknown;
    update?: unknown;
    expectError?: boolean;
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
      | "brave"
      | "semantic-scholar"
      | "elsevier-scopus"
      | "springer-openaccess"
      | "core";
    expectErrorIncludes?: string;
  }>;
  onlineResearch: Array<{
    name: string;
    query: string;
    mode: "web" | "academic" | "standard" | "patent";
    provider: "tavily" | "brave";
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

function readPath(value: any, rawPath: string) {
  return rawPath.split(".").reduce((current, key) => current?.[key], value);
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

async function evaluatePlanner(cases: CasesFile["planner"]) {
  for (const item of cases) {
    await runCase("agent-planner", item.name, () => {
      const messages = [{ role: "user", content: item.message }];
      const plan = buildControlledAgentPlan(messages, item.allow);
      const decision = planControlledChatTools(messages, item.allow);
      const selected = new Set(
        plan.items.filter((entry) => entry.selected).map((entry) => entry.id),
      );

      for (const id of item.selected) {
        assertCondition(selected.has(id), `未触发预期工具：${id}`);
      }
      for (const id of item.unselected) {
        assertCondition(!selected.has(id), `误触发工具：${id}`);
      }
      assertCondition(decision.query.length > 0, "规划查询为空");
      return `selected=${Array.from(selected).join(",") || "none"}`;
    });
  }
}

async function evaluateDesignCalculations(
  cases: CasesFile["designCalculations"],
) {
  for (const item of cases) {
    await runCase("design-calculation", item.name, () => {
      const output = executeDesignCalculation({
        type: item.type,
        input: item.input,
      });
      const result = output.result as any;
      for (const expectation of item.expect) {
        const actual = readPath(result, expectation.path);
        if ("equals" in expectation) {
          assertCondition(
            actual === expectation.equals,
            `${expectation.path}=${actual}，期望 ${expectation.equals}`,
          );
        }
        if (typeof expectation.approx === "number") {
          const tolerance = expectation.tolerance ?? 0;
          assertCondition(
            typeof actual === "number" &&
              Math.abs(actual - expectation.approx) <= tolerance,
            `${expectation.path}=${actual}，期望 ${expectation.approx}±${tolerance}`,
          );
        }
        if (typeof expectation.min === "number") {
          assertCondition(
            typeof actual === "number" && actual >= expectation.min,
            `${expectation.path}=${actual}，小于 ${expectation.min}`,
          );
        }
      }
      return `type=${item.type}`;
    });
  }
}

async function evaluateRagKg(cases: CasesFile["ragKg"]) {
  for (const item of cases) {
    await runCase("rag-kg", item.name, async () => {
      const context = await buildExternalRagKgContext([
        { role: "user", content: item.query },
      ]);
      assertCondition(context, "RAG/KG 未返回上下文");
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

async function evaluateStructureVisualizations(
  cases: CasesFile["structureVisualizations"],
) {
  for (const item of cases) {
    await runCase("structure-visualization", item.name, () => {
      const context = buildExternalStructureVisualizationContext([
        { role: "user", content: item.query },
      ]);
      assertCondition(context, "结构可视化未返回结果");
      assertCondition(
        context.visualizations.length >= item.minVisualizations,
        `结构可视化数量 ${context.visualizations.length} 小于 ${item.minVisualizations}`,
      );
      const types = new Set(context.visualizations.map((entry) => entry.type));
      for (const type of item.expectedTypes) {
        assertCondition(types.has(type as any), `缺少结构可视化类型：${type}`);
      }
      return `visualizations=${context.visualizations.length}`;
    });
  }
}

async function evaluateSimulationJobDrafts(
  cases: CasesFile["simulationJobDrafts"],
) {
  for (const item of cases) {
    await runCase("simulation-job-draft", item.name, () => {
      const context = buildExternalSimulationJobContext([
        { role: "user", content: item.query },
      ]);
      assertCondition(context, "仿真任务草案未返回结果");
      assertCondition(context.drafts.length > 0, "仿真任务草案为空");
      const draft = context.drafts[0];
      assertCondition(
        draft.solver === item.expectedSolver,
        `solver=${draft.solver}，期望 ${item.expectedSolver}`,
      );
      for (const output of item.expectedOutputs) {
        assertCondition(
          draft.input.outputs.includes(output),
          `缺少输出指标：${output}`,
        );
      }
      for (const field of item.expectedMissingFields) {
        assertCondition(
          draft.input.missingFields.includes(field),
          `缺少缺失参数：${field}`,
        );
      }
      const createPayload = simulationJobCreateSchema.safeParse({
        title: draft.title,
        solver: draft.solver,
        input: draft.input,
        conversationId: "eval-conversation",
        messageId: "eval-message",
      });
      assertCondition(
        createPayload.success,
        "仿真任务草案无法作为任务创建参数",
      );
      return `solver=${draft.solver}, outputs=${draft.input.outputs.length}`;
    });
  }
}

async function evaluateSimulationJobs(cases: CasesFile["simulationJobs"]) {
  for (const item of cases) {
    await runCase("simulation-job", item.name, () => {
      const createResult = simulationJobCreateSchema.safeParse(item.create);
      if (item.expectError) {
        assertCondition(!createResult.success, "未拒绝无效仿真任务");
        return "expected-error";
      }

      assertCondition(createResult.success, "仿真任务创建参数无效");
      if (item.update !== undefined) {
        const updateResult = simulationJobUpdateSchema.safeParse(item.update);
        assertCondition(updateResult.success, "仿真任务更新参数无效");
      }
      return `solver=${createResult.data.solver}`;
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
  await evaluatePlanner(cases.planner);
  await evaluateDesignCalculations(cases.designCalculations);
  await evaluateRagKg(cases.ragKg);
  await evaluateKnowledgeGraph(cases.knowledgeGraph);
  await evaluateStructureVisualizations(cases.structureVisualizations);
  await evaluateSimulationJobDrafts(cases.simulationJobDrafts);
  await evaluateSimulationJobs(cases.simulationJobs);
  await evaluateFileExtraction(cases.fileExtraction);
  await evaluateFileContextIds(cases.fileContextIds);
  await evaluateResearchModes(cases.researchModes);
  await evaluateOnlineResearch(cases.onlineResearch);
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
