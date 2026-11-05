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
import {
  detectDeterministicDesignIntent,
  detectFEMReadyDesignIntent,
  requestDeterministicDesign,
} from "../app/utils/server-deterministic-design";
import {
  CSGPT_CONTEXT_SAFETY_MARGIN,
  applyCSGPTContextBudget,
} from "../app/utils/csgpt-context-budget";
import {
  buildDeterministicLaminateAnalysis,
  detectLaminateAnalysisIntent,
} from "../app/utils/server-laminate-analysis";
import { estimateTokenLength } from "../app/utils/token";
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
  deterministicDesign: Array<{
    name: string;
    prompt: string;
    expectedDetected: boolean;
    expectedMode?: "concept_layup_enumeration" | "fem_ready_cylindrical_shell";
    expectedCandidateCount?: number;
    expectedLayerCount?: number;
    expectedAllowedAngles?: number[];
    expectedPlyThickness?: number | null;
    expectedSymmetric?: boolean;
    expectedBalanced?: boolean;
    expectedParameters?: Record<
      string,
      Array<string | number | boolean | null>
    >;
    expectedLengthMm?: number;
    expectedRadiusMm?: number;
    expectedServiceDepthM?: number;
    expectedExternalPressureMPa?: number;
    expectedFEMPlyCount?: number;
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

async function evaluateDeterministicDesign(
  cases: CasesFile["deterministicDesign"],
) {
  for (const item of cases) {
    await runCase("deterministic-design", item.name, () => {
      const messages = [{ role: "user", content: item.prompt }];
      const intent =
        detectFEMReadyDesignIntent(messages) ||
        detectDeterministicDesignIntent(messages);
      if (!item.expectedDetected) {
        assertCondition(!intent, "不应触发确定性候选生成");
        return "not-detected";
      }
      assertCondition(intent, "未识别严格批量候选请求");
      assertCondition(
        intent.mode === item.expectedMode,
        `mode=${intent.mode}，期望 ${item.expectedMode}`,
      );
      assertCondition(
        intent.candidateCount === item.expectedCandidateCount,
        `candidateCount=${intent.candidateCount}，期望 ${item.expectedCandidateCount}`,
      );
      if (intent.mode === "fem_ready_cylindrical_shell") {
        assertCondition(
          intent.payload.geometry.length_mm === item.expectedLengthMm,
          `length=${intent.payload.geometry.length_mm}，期望 ${item.expectedLengthMm}`,
        );
        assertCondition(
          intent.payload.geometry.radius_mm === item.expectedRadiusMm,
          `radius=${intent.payload.geometry.radius_mm}，期望 ${item.expectedRadiusMm}`,
        );
        assertCondition(
          intent.payload.load_conditions.service_depth_m ===
            item.expectedServiceDepthM,
          `depth=${intent.payload.load_conditions.service_depth_m}，期望 ${item.expectedServiceDepthM}`,
        );
        return `count=${intent.candidateCount}, mode=${intent.mode}`;
      }
      assertCondition(
        intent.payload.layer_count === item.expectedLayerCount,
        `layerCount=${intent.payload.layer_count}，期望 ${item.expectedLayerCount}`,
      );
      assertCondition(
        JSON.stringify(intent.payload.allowed_angles_deg) ===
          JSON.stringify(item.expectedAllowedAngles),
        `allowedAngles=${JSON.stringify(intent.payload.allowed_angles_deg)}`,
      );
      assertCondition(
        intent.payload.ply_thickness_mm === item.expectedPlyThickness,
        `plyThickness=${intent.payload.ply_thickness_mm}，期望 ${item.expectedPlyThickness}`,
      );
      if (item.expectedSymmetric !== undefined) {
        assertCondition(
          intent.payload.symmetric === item.expectedSymmetric,
          `symmetric=${intent.payload.symmetric}，期望 ${item.expectedSymmetric}`,
        );
      }
      if (item.expectedBalanced !== undefined) {
        assertCondition(
          intent.payload.balanced === item.expectedBalanced,
          `balanced=${intent.payload.balanced}，期望 ${item.expectedBalanced}`,
        );
      }
      assertCondition(
        JSON.stringify(intent.payload.parameter_values) ===
          JSON.stringify(item.expectedParameters || {}),
        `parameterValues=${JSON.stringify(intent.payload.parameter_values)}`,
      );
      return `count=${intent.candidateCount}, layers=${intent.payload.layer_count}`;
    });
  }

  const onlineCase = cases.find(
    (item) =>
      item.expectedDetected &&
      item.expectedMode === "fem_ready_cylindrical_shell",
  );
  if (!onlineCase) return;
  if (process.env.CSGPT_EVAL_DESIGN_ONLINE !== "1") {
    skip(
      "deterministic-design",
      "真实确定性设计服务",
      "设置 CSGPT_EVAL_DESIGN_ONLINE=1 后执行",
    );
    return;
  }
  const baseUrl =
    process.env.CSGPT_CS2_DESIGN_BASE_URL || process.env.CSGPT_CS2_BASE_URL;
  const apiKey =
    process.env.CSGPT_CS2_DESIGN_API_KEY || process.env.CSGPT_CS2_API_KEY;
  await runCase("deterministic-design", "真实确定性设计服务", async () => {
    assertCondition(baseUrl, "CS2 确定性设计服务地址未配置");
    const messages = [{ role: "user", content: onlineCase.prompt }];
    const intent =
      detectFEMReadyDesignIntent(messages) ||
      detectDeterministicDesignIntent(messages);
    assertCondition(intent, "在线用例未识别为严格批量候选请求");
    const response = await requestDeterministicDesign(intent, {
      baseUrl,
      apiKey,
    });
    assertCondition(
      response.generation_mode === "fem_ready_cylindrical_shell",
      `在线响应模式错误：${response.generation_mode}`,
    );
    assertCondition(
      typeof onlineCase.expectedExternalPressureMPa === "number" &&
        Math.abs(
          response.result.request.load_conditions.external_pressure_MPa -
            onlineCase.expectedExternalPressureMPa,
        ) < 1e-6,
      "在线响应静水压力不匹配",
    );
    assertCondition(
      response.result.candidates.every(
        (candidate) =>
          candidate.layup.ply_count === onlineCase.expectedFEMPlyCount &&
          candidate.layup.balanced === true &&
          candidate.layup.symmetric ===
            candidate.layup.angles_deg.every(
              (angle, index, sequence) =>
                angle === sequence[sequence.length - index - 1],
            ) &&
          candidate.provenance.source_laminate_stiffness_validation.status ===
            "recomputed_from_explicit_sequence",
      ),
      "在线 FEM-ready 候选的层数、铺层声明或源表刚度追溯无效",
    );
    return `count=${response.result.candidate_count}, fingerprint=${response.result.design_fingerprint}`;
  });
}

function evaluateContextBudgetRegression() {
  const messages = [
    { role: "system", content: "系统约束：必须如实说明证据边界。" },
    { role: "user", content: "旧问题：请解释材料和边界条件。" },
    { role: "assistant", content: "旧回答：" + "历史回答内容。".repeat(5000) },
    { role: "user", content: "当前问题：请保留当前输入并给出完整回答。" },
  ];
  const bounded = applyCSGPTContextBudget(
    messages,
    { max_tokens: 16384 },
    16384,
  );
  const contents = bounded.messages.map((message) => String(message.content));
  assertCondition(contents.includes(messages[0].content), "系统消息未保留");
  assertCondition(contents.includes(messages[3].content), "当前用户消息未保留");
  const oldUserRetained = contents.includes(messages[1].content);
  const oldAssistantRetained = contents.some((content) =>
    content.startsWith("旧回答："),
  );
  assertCondition(
    !oldUserRetained || oldAssistantRetained,
    "裁剪后留下了没有对应回答的旧用户消息",
  );
  assertCondition(
    oldAssistantRetained ||
      !contents.some((content) => content.includes("旧回答：")),
    "历史回答裁剪状态无法核对",
  );

  const estimatedInput = bounded.messages.reduce(
    (total, message) =>
      total + 4 + estimateTokenLength(String(message.content)),
    0,
  );
  const outputTokens = Number(bounded.rest.max_tokens);
  assertCondition(
    estimatedInput + outputTokens <= 16384 - CSGPT_CONTEXT_SAFETY_MARGIN,
    "输出预算没有遵守共享上下文上限",
  );

  const oversizedAugmentedContext = [
    {
      role: "system",
      content: "核心工程约束：不得把历史参考值写成当前有限元结果。",
      _csgptContextPriority: 100,
    },
    {
      role: "system",
      content: "检索上下文：" + "复合材料圆柱壳知识条目。".repeat(9000),
      _csgptContextPriority: 20,
    },
    {
      role: "system",
      content:
        "设计说明：只解释已生成的结构化字段，不重新生成候选；说明输入合同和校核边界。",
      _csgptContextPriority: 80,
    },
    {
      role: "user",
      content:
        "请解释 TMP_1 的对称性和均衡性，并说明是否可进入 Abaqus 子模型。",
    },
  ];
  const boundedAugmented = applyCSGPTContextBudget(
    oversizedAugmentedContext,
    { max_tokens: 16384 },
    16384,
  );
  const boundedAugmentedContents = boundedAugmented.messages.map((message) =>
    String(message.content),
  );
  const boundedAugmentedInput = boundedAugmented.messages.reduce(
    (total, message) =>
      total + 4 + estimateTokenLength(String(message.content)),
    0,
  );
  assertCondition(
    boundedAugmentedContents.some((content) =>
      content.includes("核心工程约束"),
    ),
    "超长增强上下文导致核心工程约束丢失",
  );
  assertCondition(
    boundedAugmentedContents.some((content) => content.includes("设计说明")),
    "超长增强上下文导致设计说明丢失",
  );
  assertCondition(
    boundedAugmentedContents.some((content) => content.includes("TMP_1")),
    "超长增强上下文导致当前用户问题丢失",
  );
  assertCondition(
    boundedAugmentedInput + Number(boundedAugmented.rest.max_tokens) <=
      16384 - CSGPT_CONTEXT_SAFETY_MARGIN,
    "超长增强上下文裁剪后仍超过共享上下文上限",
  );

  const structuredFollowup = [
    oversizedAugmentedContext[0],
    oversizedAugmentedContext[1],
    {
      role: "user",
      content: "请生成 FEM-ready 圆柱壳候选。",
    },
    {
      role: "assistant",
      content:
        "上一轮结构化结果：TMP_1 材料为 IM7-8552，40 层显式铺层，待进入 Abaqus 子模型复核。".repeat(
          3000,
        ),
    },
    {
      role: "user",
      content: "请只解释 TMP_1 的对称性和均衡性，不重新生成候选。",
    },
  ];
  const boundedFollowup = applyCSGPTContextBudget(
    structuredFollowup,
    { max_tokens: 16384 },
    16384,
  );
  const boundedFollowupContents = boundedFollowup.messages.map((message) =>
    String(message.content),
  );
  assertCondition(
    boundedFollowupContents.includes(structuredFollowup[2].content),
    "结构化结果追问丢失上一轮用户任务",
  );
  assertCondition(
    boundedFollowupContents.some((content) =>
      content.includes("TMP_1 材料为 IM7-8552"),
    ),
    "结构化结果追问丢失上一轮 TMP_1 字段",
  );
  assertCondition(
    boundedFollowupContents.includes(structuredFollowup[4].content),
    "结构化结果追问丢失当前用户问题",
  );
}

function evaluateLaminateDeterministicFacts() {
  const messages = [
    {
      role: "assistant",
      content:
        "| 编号 | 对称 | 均衡 | 40 层显式铺层（外到内） |\n|---|---|---|---|\n| TMP_1 | 否 | 是 | [90°/90°/90°/90°/25°/-25°/80°/-80°/25°/-25°/80°/-80°/25°/-25°/80°/-80°/25°/-25°/80°/-80°/25°/-25°/80°/-80°/25°/-25°/80°/-80°/25°/-25°/80°/-80°/25°/-25°/80°/-80°/90°/90°/90°/90°] |",
    },
    {
      role: "user",
      content:
        "请解释 TMP_1 的 ABD、对称性和均衡性，不要重新生成候选，也不要猜测当前 Abaqus 结果。",
    },
  ];
  assertCondition(
    detectLaminateAnalysisIntent(messages),
    "未识别层合板事实核验问题",
  );
  const answer = buildDeterministicLaminateAnalysis(messages);
  assertCondition(
    answer.includes("TMP_1：40 层；逐层复算为 symmetric=false, balanced=true"),
    "没有按显式层序复算 TMP_1 的布尔属性",
  );
  assertCondition(answer.includes("第 5 层"), "没有暴露对称性首个不一致位置");
  assertCondition(
    answer.includes("不能推出 B=0") &&
      answer.includes("不是当前 Abaqus 求解结果"),
    "没有保留 B 矩阵和当前 FEM 证据边界",
  );
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
  await runCase("context-budget", "历史轮次裁剪与共享窗口预算", () => {
    evaluateContextBudgetRegression();
    return "system/current preserved; orphan history removed";
  });
  await runCase("laminate-analysis", "显式铺层序列事实复核", () => {
    evaluateLaminateDeterministicFacts();
    return "sequence symmetry/balance and ABD evidence boundary preserved";
  });
  await evaluateDeterministicDesign(cases.deterministicDesign);
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
