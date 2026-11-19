import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import {
  createResearchRecorder,
  readResearchCapture,
  readReusableReport,
  selectResearchMode,
} from "./evaluation-research";

import { extractTextFromFile } from "../app/utils/file-text-extractor";
import {
  executeResearchSearch,
  getConfiguredResearchSearchProviders,
  getResearchSearchToolCatalog,
  isCompositeMaterialsResult,
  isPatentDocumentUrl,
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
  buildLaminateCalculationContext,
  detectLaminateAnalysisIntent,
} from "../app/utils/server-laminate-analysis";
import { estimateTokenLength } from "../app/utils/token";
import {
  evidenceReference,
  formatRagEvidence,
} from "../app/utils/rag-evidence";
import {
  encodeRagKgSourcesHeader,
  parseRagKgSourcesHeader,
  RAG_KG_SOURCES_HEADER,
  type RagKgDocumentSource,
} from "../app/utils/rag-kg-sources";

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
    expectEmpty?: boolean;
    requiredEvidencePattern?: string;
    requiredTableProjection?: boolean;
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
const caseMetrics: Array<{
  suite: string;
  name: string;
  duration_ms: number;
  rss_start_bytes: number;
  rss_end_bytes: number;
  sampled_peak_rss_bytes: number;
  process_peak_rss_bytes: number;
}> = [];
const RSS_SAMPLE_INTERVAL_MS = 50;
const ragEvidence: Array<{
  name: string;
  query: string;
  context: Awaited<ReturnType<typeof buildInternalKnowledgeContext>>;
}> = [];
const graphEvidence: Array<{
  name: string;
  query: string;
  graph: Awaited<ReturnType<typeof queryKnowledgeGraph>>;
}> = [];
let researchRecorder = createResearchRecorder();

const evidenceFiles = [
  "data/csllm/provenance/manifest.json",
  "data/csllm/provenance/file_manifest.jsonl",
  "data/csllm/runtime/rag_chunks.compact.jsonl.gz",
  "data/csllm/runtime/relations.compact.jsonl.gz",
  "data/csllm/kg/entities.jsonl",
  "data/csllm/kg/kg_stats.json",
  "data/csllm/provenance/README.md",
  "package-lock.json",
  "scripts/evaluate-csgpt.ts",
  "scripts/evaluation-research.ts",
  "evals/csgpt/engineering-cases.json",
  "app/utils/server-rag-kg.ts",
  "app/utils/rag-evidence.ts",
  "app/utils/rag-quality.ts",
  "app/utils/rag-kg-sources.ts",
  "app/utils/knowledge-graph.ts",
  "app/utils/research-search-registry.ts",
  "app/utils/research-sources.ts",
];

// 报告绑定实际读取的数据与检索实现，不包含环境凭据。
async function fingerprintEvidenceFiles() {
  const files = [];
  for (const file of evidenceFiles) {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of fs.createReadStream(file)) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    files.push({ path: file, bytes, sha256: hash.digest("hex") });
  }
  return files;
}

function evaluationOptions() {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
      "online-research-only": { type: "boolean", default: false },
      "reuse-report": { type: "string" },
      "replay-research": { type: "string" },
      "research-mode": { type: "string" },
    },
  });
  if (
    values["reuse-report"] &&
    (!values["online-research-only"] || !values.report)
  ) {
    throw new Error("复用报告要求 --online-research-only 和 --report");
  }
  if (values["replay-research"] && !values["online-research-only"]) {
    throw new Error("响应回放要求 --online-research-only");
  }
  const options = {
    reportPath: null as string | null,
    onlineResearchOnly: values["online-research-only"],
    reuseReport: values["reuse-report"],
    replayResearch: values["replay-research"],
    researchMode: selectResearchMode(
      values["research-mode"],
      values["online-research-only"] === true,
    ),
  };
  if (!values.report) return options;
  const root = path.resolve("evals/csgpt/results");
  const reportPath = path.resolve(values.report);
  const relative = path.relative(root, reportPath);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !reportPath.endsWith(".json")
  ) {
    throw new Error("报告路径须位于 evals/csgpt/results 下，扩展名为 .json");
  }
  if (fs.existsSync(reportPath)) {
    throw new Error("报告文件已存在，请使用不同文件名保留各次运行证据");
  }
  return { ...options, reportPath };
}

function loadCases() {
  const filePath = path.join(
    process.cwd(),
    "evals",
    "csgpt",
    "engineering-cases.json",
  );
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as CasesFile;
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
  const started = performance.now();
  const rssStart = process.memoryUsage.rss();
  let sampledPeakRss = rssStart;
  // 在现有用例执行期间采样，不为资源统计重复检索；OS 峰值是进程累计高水位。
  const sampleRss = () => {
    sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage.rss());
  };
  const sampler = setInterval(sampleRss, RSS_SAMPLE_INTERVAL_MS);
  try {
    const detail = await fn();
    pass(suite, name, detail || undefined);
  } catch (error) {
    fail(suite, name, error instanceof Error ? error.message : String(error));
  } finally {
    clearInterval(sampler);
    sampleRss();
    caseMetrics.push({
      suite,
      name,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      rss_start_bytes: rssStart,
      rss_end_bytes: process.memoryUsage.rss(),
      sampled_peak_rss_bytes: sampledPeakRss,
      process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    });
  }
}

async function evaluateRagKg(cases: CasesFile["ragKg"]) {
  for (const item of cases) {
    await runCase("rag-kg", item.name, async () => {
      const context = await buildInternalKnowledgeContext([
        { role: "user", content: item.query },
      ]);
      ragEvidence.push({ name: item.name, query: item.query, context });
      if (item.expectEmpty) {
        assertCondition(context === null, "无检索词的问题返回了无关资料");
        return "no-evidence";
      }
      assertCondition(context, "内部知识库未返回上下文");
      assertCondition(
        context.message.length <= 12000,
        "上下文超过整包字符预算",
      );
      for (const excerpt of context.excerpts) {
        assertCondition(
          excerpt.evidence.retrieval_eligible === true,
          "返回了不可检索证据",
        );
        assertCondition(
          context.message.includes(formatRagEvidence(excerpt.evidence)),
          "证据正文、条件或列投影被截断",
        );
        for (const condition of [
          ...excerpt.evidence.applicability_context,
          ...excerpt.evidence.table_evidence.flatMap(
            (table) => table.condition_context,
          ),
        ]) {
          assertCondition(
            context.message.includes(condition),
            "条件原文未完整传入上下文",
          );
        }
        const source = context.sources.find(
          (source) => source.id === excerpt.sourceId,
        );
        assertCondition(
          JSON.stringify(source?.evidence) ===
            JSON.stringify(evidenceReference(excerpt.evidence)),
          "引用身份与上下文分块不一致",
        );
      }
      for (const source of context.sources) {
        assertCondition(
          context.excerpts.some(
            (excerpt) =>
              JSON.stringify(source.evidence) ===
              JSON.stringify(evidenceReference(excerpt.evidence)),
          ),
          "来源没有对应的当前完整分块",
        );
      }
      if (item.requiredTableProjection) {
        assertCondition(
          context.excerpts.some((excerpt) =>
            excerpt.evidence.table_evidence.some(
              (table) => table.column_projection,
            ),
          ),
          "检索结果缺少表格列投影",
        );
      }
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
      if (item.requiredEvidencePattern) {
        // 逐段检查实际传给模型的正文，题名和用户问题不作为命中证据。
        const excerpts = context.excerpts.map((item) => item.text);
        assertCondition(excerpts.length > 0, "检索结果缺少正文证据");
        const pattern = new RegExp(item.requiredEvidencePattern, "i");
        for (const excerpt of excerpts) {
          assertCondition(pattern.test(excerpt), "检索段落缺少所问技术分量");
        }
      }
      const encoded = encodeRagKgSourcesHeader(context.sources);
      const decoded = parseRagKgSourcesHeader(
        new Response(null, {
          headers: { [RAG_KG_SOURCES_HEADER]: encoded },
        }),
      );
      assertCondition(
        JSON.stringify(decoded) === JSON.stringify(context.sources),
        "来源在响应头传输中丢失",
      );
      const referencedIds = new Set(
        Array.from(
          context.message.matchAll(/(?:来源 |知识关系 |依据 )([SK]\d+)\b/g),
          (match) => match[1],
        ),
      );
      const sourceIds = new Set(decoded.map((source) => source.id));
      assertCondition(
        sourceIds.size === referencedIds.size &&
          Array.from(sourceIds).every((id) => referencedIds.has(id)),
        "上下文与界面的来源编号不一致",
      );
      return `sources=${context.sources.length}`;
    });
  }
}

async function evaluateKnowledgeGraph(cases: CasesFile["knowledgeGraph"]) {
  for (const item of cases) {
    await runCase("knowledge-graph", item.name, async () => {
      const graph = await queryKnowledgeGraph(item.query, 40);
      graphEvidence.push({ name: item.name, query: item.query, graph });
      assertCondition(graph.mode === "query", "图谱模式不是 query");
      for (const edge of graph.edges) {
        assertCondition(
          edge.evidence.retrieval_eligible &&
            edge.evidence.record_id === edge.recordId &&
            !!edge.evidence.chunk_fingerprint,
          "图谱关系没有当前分块证据",
        );
      }
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

async function evaluateLaminateDeterministicFacts() {
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
  const answer = await buildLaminateCalculationContext(messages);
  assertCondition(
    answer!.includes("TMP_1：40 层；角度序列对称=false，正负角层数均衡=true"),
    "没有按显式层序复算 TMP_1 的布尔属性",
  );
  assertCondition(answer!.includes("第 5 层"), "没有暴露对称性首个不一致位置");
  assertCondition(
    answer!.includes("不能仅据此判定 B 矩阵"),
    "没有限定角度序列核验的计算范围",
  );

  const fieldNameFollowup = [
    messages[0],
    {
      role: "assistant",
      content:
        "## 核验结果\n\n| 编号 | 材料 | 对称 | 均衡 | 第一个镜像不一致位置 |\n|---|---|---|---|---|\n| TMP_1 | M40J/TDE-85 | 否 | 是 | 外到内第 1 层与第 40 层，角度分别为 90° 与 90° |",
    },
    {
      role: "user",
      content:
        "只核验已生成的 TMP_1，不要生成候选或改变候选表：返回其 symmetric、balanced；若 symmetric=false，指出从外到内的第一个镜像不一致层位及两侧角度。",
    },
  ];
  assertCondition(
    detectLaminateAnalysisIntent(fieldNameFollowup),
    "未识别使用 symmetric/balanced/mirror 字段的层合板事实核验问题",
  );
  const contextRecovered =
    await buildLaminateCalculationContext(fieldNameFollowup);
  assertCondition(
    contextRecovered!.includes("第 5 层") &&
      !contextRecovered!.includes("第 1 层 90° 与第 40 层 90°"),
    "没有跳过缺少显式铺层的摘要表并恢复原始候选层序",
  );

  const structuredContext = [
    {
      role: "system",
      content: "上一轮结果摘要不含逐层铺层。",
    },
    {
      role: "developer",
      content: `上一轮结构化设计工件：${JSON.stringify({
        result: {
          candidates: [
            {
              candidate_id: "TMP_1",
              layup: {
                angles_deg: [
                  90, 90, 90, 90, 25, -25, 80, -80, 25, -25, 80, -80, 25, -25,
                  80, -80, 25, -25, 80, -80, 25, -25, 80, -80, 25, -25, 80, -80,
                  25, -25, 80, -80, 25, -25, 80, -80, 90, 90, 90, 90,
                ],
                symmetric: false,
                balanced: true,
              },
            },
          ],
        },
      })}`,
    },
    fieldNameFollowup[1],
    fieldNameFollowup[2],
  ];
  const structuredAnswer =
    await buildLaminateCalculationContext(structuredContext);
  assertCondition(
    structuredAnswer!.includes(
      "TMP_1：40 层；角度序列对称=false，正负角层数均衡=true",
    ) && structuredAnswer!.includes("第 5 层"),
    "没有从结构化设计工件复算显式层序",
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
      const result = await researchRecorder.search({
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
      if (item.mode === "patent") {
        assertCondition(
          result.results.every((entry) => isPatentDocumentUrl(entry.url)),
          "专利检索包含未定位到专利文献的来源",
        );
      }
      return `provider=${result.provider}, results=${result.results.length}`;
    });
  }
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
        const search = await researchRecorder.search({
          query,
          mode: "academic",
          provider,
          maxResults: 3,
        });
        results.push(...search.results);
      } catch (error) {
        fail(
          "online-research-provider",
          provider,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    assertCondition(results.length >= 3, `结果数量 ${results.length} 小于 3`);
    const unrelated = results.filter(
      (result) => !isCompositeMaterialsResult(result),
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
  const options = evaluationOptions();
  const { reportPath } = options;
  const startedAt = new Date().toISOString();
  const reusedReport = options.reuseReport
    ? await readReusableReport(options.reuseReport)
    : undefined;
  const filesBefore = reportPath ? await fingerprintEvidenceFiles() : null;
  // 与 Next.js 服务使用同一环境文件优先级，不输出配置值。
  loadEnvConfig(process.cwd());
  if (options.onlineResearchOnly && process.env.CSGPT_EVAL_ONLINE !== "1") {
    throw new Error("定向在线检索要求 CSGPT_EVAL_ONLINE=1");
  }
  if (
    options.onlineResearchOnly &&
    process.env.CSGPT_EVAL_DESIGN_ONLINE === "1"
  ) {
    throw new Error(
      "定向在线检索不执行设计服务，请设置 CSGPT_EVAL_DESIGN_ONLINE=0",
    );
  }
  const researchCapture = options.replayResearch
    ? readResearchCapture(options.replayResearch)
    : undefined;
  researchRecorder = createResearchRecorder(
    researchCapture ? { capture: researchCapture } : undefined,
  );

  if (typeof globalThis.atob !== "function") {
    globalThis.atob = (value: string) =>
      Buffer.from(value, "base64").toString("binary");
  }
  if (typeof globalThis.btoa !== "function") {
    globalThis.btoa = (value: string) =>
      Buffer.from(value, "binary").toString("base64");
  }

  const cases = loadCases();
  if (!options.onlineResearchOnly) {
    await evaluateRagKg(cases.ragKg);
    await evaluateKnowledgeGraph(cases.knowledgeGraph);
    await evaluateFileExtraction(cases.fileExtraction);
    await evaluateFileContextIds(cases.fileContextIds);
    await runCase("context-budget", "历史轮次裁剪与共享窗口预算", () => {
      evaluateContextBudgetRegression();
      return "system/current preserved; orphan history removed";
    });
    if (process.env.CSGPT_EVAL_DESIGN_ONLINE === "1") {
      await runCase("laminate-analysis", "显式铺层序列事实复核", () => {
        return evaluateLaminateDeterministicFacts().then(
          () => "sequence symmetry/balance and ABD evidence boundary preserved",
        );
      });
    } else {
      skip(
        "laminate-analysis",
        "显式铺层序列事实复核",
        "设置 CSGPT_EVAL_DESIGN_ONLINE=1 后执行",
      );
    }
    await evaluateDeterministicDesign(cases.deterministicDesign);
    await evaluateResearchModes(cases.researchModes);
    await evaluateDatabaseMigrations(cases.databaseMigrations);
  } else if (reusedReport) {
    results.push(
      ...reusedReport.report.results.filter(
        (entry) => entry.suite !== "online-research",
      ),
    );
  }
  await evaluateOnlineResearch(
    cases.onlineResearch.filter(
      (item) => !options.researchMode || item.mode === options.researchMode,
    ),
  );
  if (!options.researchMode || options.researchMode === "academic") {
    await evaluateOnlineAcademicRelevance();
  }

  if (reportPath) {
    const filesAfter = await fingerprintEvidenceFiles();
    const filesUnchanged =
      JSON.stringify(filesBefore) === JSON.stringify(filesAfter);
    if (!filesUnchanged) {
      fail("evidence", "输入与实现文件一致性", "评测期间文件内容发生变化");
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          schema_version: reusedReport ? 2 : 1,
          execution: {
            command: `npm run eval:csgpt -- ${process.argv.slice(2).join(" ")}`,
            scope: options.onlineResearchOnly ? "online-research" : "all",
            research_mode: options.researchMode,
            configuration: "Next.js 环境配置优先级，凭据不进入报告",
          },
          reused_report: reusedReport,
          response_capture: researchCapture
            ? {
                path: researchCapture.path,
                sha256: researchCapture.sha256,
                result_review: researchCapture.result_review,
              }
            : undefined,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            online_research: process.env.CSGPT_EVAL_ONLINE === "1",
            research_transport: researchCapture ? "recorded-response" : "live",
            online_design: process.env.CSGPT_EVAL_DESIGN_ONLINE === "1",
          },
          files_before: filesBefore,
          files_after: filesAfter,
          files_unchanged: filesUnchanged,
          results,
          failures,
          performance: {
            rss_sample_interval_ms: RSS_SAMPLE_INTERVAL_MS,
            process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
            cases: caseMetrics,
          },
          rag: ragEvidence,
          knowledge_graph: graphEvidence,
          online_research: researchRecorder.attempts,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(`报告：${path.relative(process.cwd(), reportPath)}`);
  }

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
