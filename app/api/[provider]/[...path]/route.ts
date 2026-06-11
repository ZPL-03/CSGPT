import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { getUserFromRequest } from "@/app/lib/auth";
import {
  CSGPT_DEFAULT_MODEL,
  CSGPT_MODEL_2,
  CSGPT_MODEL_3,
} from "@/app/constant";
import { CSGPT_SYSTEM_PROMPT } from "@/app/prompts/csgpt";
import { buildExternalRagKgContext } from "@/app/utils/server-rag-kg";
import {
  encodeRagKgSourcesHeader,
  RAG_KG_SOURCES_HEADER,
  type RagKgSource,
} from "@/app/utils/rag-kg-sources";
import {
  encodeResearchSourcesHeader,
  RESEARCH_SOURCES_HEADER,
  type ResearchSource,
} from "@/app/utils/research-sources";
import { buildExternalResearchContext } from "@/app/utils/server-research";
import { buildExternalDesignCalculationContext } from "@/app/utils/server-design-calculation";
import {
  DESIGN_CALCULATION_RESULTS_HEADER,
  encodeDesignCalculationResultsHeader,
  type DesignCalculationTrace,
} from "@/app/utils/design-calculation-results";
import { buildExternalStructureVisualizationContext } from "@/app/utils/server-structure-visualization";
import {
  encodeStructureVisualizationResultsHeader,
  STRUCTURE_VISUALIZATION_RESULTS_HEADER,
  type StructureVisualizationTrace,
} from "@/app/utils/structure-visualization-results";
import {
  encodeSessionFileSourcesHeader,
  SESSION_FILE_SOURCES_HEADER,
  type SessionFileSource,
} from "@/app/utils/session-file-sources";
import {
  buildSessionFileRagContext,
  type SessionFileRecord,
} from "@/app/utils/server-session-file-rag";
import { buildUserFileRagContext } from "@/app/utils/server-user-file-rag";
import {
  encodeUserFileSourcesHeader,
  USER_FILE_SOURCES_HEADER,
  type UserFileSource,
} from "@/app/utils/user-file-sources";
import {
  CONTROLLED_TOOL_RECORDS_HEADER,
  createControlledToolRecord,
  encodeControlledToolRecordsHeader,
  type ControlledToolRecord,
} from "@/app/utils/controlled-tool-records";
import {
  buildControlledAgentPlan,
  planControlledChatTools,
  type ControlledAgentPlan,
} from "@/app/utils/server-agent-planner";
import {
  CONTROLLED_AGENT_PLAN_HEADER,
  encodeControlledAgentPlanHeader,
} from "@/app/utils/controlled-agent-plan";
import { buildExternalSimulationJobContext } from "@/app/utils/server-simulation-job";
import {
  encodeSimulationJobDraftsHeader,
  SIMULATION_JOB_DRAFTS_HEADER,
  type SimulationJobDraft,
} from "@/app/utils/simulation-job-results";

// 通用 API 代理路由：处理 /api/{provider}/{...path} 请求
// 根据 Provider 将请求转发到对应的后端服务

interface RouteParams {
  provider: string;
  path: string[];
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function ensureOpenAIBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function getPublicCSGPTModel(config: ReturnType<typeof getServerSideConfig>) {
  return config.csgptModelName || CSGPT_DEFAULT_MODEL;
}

type CSGPTUpstream = {
  label: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  upstreamModelName?: string;
};

function getDedicatedCSGPTUpstream(
  model: string | undefined,
  config: ReturnType<typeof getServerSideConfig>,
): CSGPTUpstream | null {
  if (!model) return null;

  const upstreams: Record<string, CSGPTUpstream> = {
    [CSGPT_MODEL_2]: {
      label: "CS2",
      model: CSGPT_MODEL_2,
      baseUrl: config.csgptCs2BaseUrl,
      apiKey: config.csgptCs2ApiKey,
      upstreamModelName: config.csgptCs2UpstreamModelName,
    },
    [CSGPT_MODEL_3]: {
      label: "CS3",
      model: CSGPT_MODEL_3,
      baseUrl: config.csgptCs3BaseUrl,
      apiKey: config.csgptCs3ApiKey,
      upstreamModelName: config.csgptCs3UpstreamModelName,
    },
  };

  return upstreams[model] ?? null;
}

function getVisibleDedicatedCSGPTUpstreams(
  config: ReturnType<typeof getServerSideConfig>,
) {
  return [CSGPT_MODEL_2, CSGPT_MODEL_3]
    .map((model) => getDedicatedCSGPTUpstream(model, config))
    .filter(
      (upstream): upstream is CSGPTUpstream => !!upstream && !!upstream.baseUrl,
    );
}

function resolveUpstreamCSGPTModel(
  requestedModel: string | undefined,
  config: ReturnType<typeof getServerSideConfig>,
) {
  const publicDefaultModel = getPublicCSGPTModel(config);

  const dedicatedUpstream = getDedicatedCSGPTUpstream(requestedModel, config);
  if (dedicatedUpstream) {
    return dedicatedUpstream.upstreamModelName || requestedModel;
  }

  if (!requestedModel || requestedModel === publicDefaultModel) {
    return (
      config.csgptUpstreamModelName || requestedModel || publicDefaultModel
    );
  }

  return requestedModel;
}

function getAuthorizationHeader(req: NextRequest, apiKey: string) {
  if (apiKey) return `Bearer ${apiKey}`;
  return req.headers.get("authorization") || "";
}

function normalizeCustomUpstreamBaseUrl(baseUrl?: string) {
  const value = String(baseUrl || "").trim();
  if (!value) return "";

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("自定义上游接口地址不是有效 URL。");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("自定义上游接口地址只支持 HTTP 或 HTTPS。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("自定义上游接口地址不能包含用户名或密码。");
  }

  return ensureOpenAIBaseUrl(value);
}

function formatSize(size?: number) {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeContentToText(content: any) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  return content
    .map((part) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "image_url") {
        const image = part.image_url ?? {};
        const meta = [image.name || "用户上传图片", formatSize(image.size)]
          .filter(Boolean)
          .join("，");
        return `[图片: ${meta}]`;
      }
      if (part?.type === "file_url") {
        const file = part.file_url ?? {};
        const meta = [file.name || "用户上传文件", formatSize(file.size)]
          .filter(Boolean)
          .join("，");
        return `[文件: ${meta}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeMessagesToText(messages: any[]) {
  return messages.map((message) => ({
    ...message,
    content: normalizeContentToText(message.content),
  }));
}

function attachRagKgSourcesHeader(headers: Headers, sources: RagKgSource[]) {
  const encoded = encodeRagKgSourcesHeader(sources);
  if (encoded) {
    headers.set(RAG_KG_SOURCES_HEADER, encoded);
  }
}

function attachResearchSourcesHeader(
  headers: Headers,
  sources: ResearchSource[],
) {
  const encoded = encodeResearchSourcesHeader(sources);
  if (encoded) {
    headers.set(RESEARCH_SOURCES_HEADER, encoded);
  }
}

function attachDesignCalculationResultsHeader(
  headers: Headers,
  results: DesignCalculationTrace[],
) {
  const encoded = encodeDesignCalculationResultsHeader(results);
  if (encoded) {
    headers.set(DESIGN_CALCULATION_RESULTS_HEADER, encoded);
  }
}

function attachStructureVisualizationResultsHeader(
  headers: Headers,
  results: StructureVisualizationTrace[],
) {
  const encoded = encodeStructureVisualizationResultsHeader(results);
  if (encoded) {
    headers.set(STRUCTURE_VISUALIZATION_RESULTS_HEADER, encoded);
  }
}

function attachSimulationJobDraftsHeader(
  headers: Headers,
  drafts: SimulationJobDraft[],
) {
  const encoded = encodeSimulationJobDraftsHeader(drafts);
  if (encoded) {
    headers.set(SIMULATION_JOB_DRAFTS_HEADER, encoded);
  }
}

function attachSessionFileSourcesHeader(
  headers: Headers,
  sources: SessionFileSource[],
) {
  const encoded = encodeSessionFileSourcesHeader(sources);
  if (encoded) {
    headers.set(SESSION_FILE_SOURCES_HEADER, encoded);
  }
}

function attachUserFileSourcesHeader(
  headers: Headers,
  sources: UserFileSource[],
) {
  const encoded = encodeUserFileSourcesHeader(sources);
  if (encoded) {
    headers.set(USER_FILE_SOURCES_HEADER, encoded);
  }
}

function attachControlledToolRecordsHeader(
  headers: Headers,
  records: ControlledToolRecord[],
) {
  const encoded = encodeControlledToolRecordsHeader(records);
  if (encoded) {
    headers.set(CONTROLLED_TOOL_RECORDS_HEADER, encoded);
  }
}

function attachControlledAgentPlanHeader(
  headers: Headers,
  plan?: ControlledAgentPlan,
) {
  if (!plan) return;
  const encoded = encodeControlledAgentPlanHeader(plan);
  if (encoded) {
    headers.set(CONTROLLED_AGENT_PLAN_HEADER, encoded);
  }
}

function buildControlledToolRecords(input: {
  ragKgEnabled: boolean;
  ragKgSources: RagKgSource[];
  webSearchEnabled: boolean;
  standardSearchEnabled: boolean;
  patentSearchEnabled: boolean;
  academicSearchEnabled: boolean;
  researchSources: ResearchSource[];
  designCalculationEnabled: boolean;
  designCalculations: DesignCalculationTrace[];
  structureVisualizationEnabled: boolean;
  structureVisualizations: StructureVisualizationTrace[];
  simulationJobEnabled: boolean;
  simulationJobTaskCount: number;
  sessionFileRagEnabled: boolean;
  sessionFileSources: SessionFileSource[];
  userFileRagEnabled: boolean;
  userFileSources: UserFileSource[];
}) {
  const records = [
    createControlledToolRecord({
      id: "csgpt-rag-kg",
      name: "知识库检索",
      enabled: input.ragKgEnabled,
      count: input.ragKgSources.length,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-web-search",
      name: "联网检索",
      enabled: input.webSearchEnabled,
      count: input.researchSources.filter((source) => source.mode === "web")
        .length,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-standard-search",
      name: "标准/规范检索",
      enabled: input.standardSearchEnabled,
      count: input.researchSources.filter(
        (source) => source.mode === "standard",
      ).length,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-patent-search",
      name: "专利检索",
      enabled: input.patentSearchEnabled,
      count: input.researchSources.filter((source) => source.mode === "patent")
        .length,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-academic-search",
      name: "学术检索",
      enabled: input.academicSearchEnabled,
      count: input.researchSources.filter(
        (source) => source.mode === "academic",
      ).length,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-design-calculation",
      name: "设计计算",
      enabled: input.designCalculationEnabled,
      count: input.designCalculations.length,
      unit: "项计算",
    }),
    createControlledToolRecord({
      id: "csgpt-structure-visualization",
      name: "结构可视化",
      enabled: input.structureVisualizationEnabled,
      count: input.structureVisualizations.length,
      unit: "张示意图",
    }),
    createControlledToolRecord({
      id: "csgpt-simulation-job",
      name: "仿真任务",
      enabled: input.simulationJobEnabled,
      count: input.simulationJobTaskCount,
      unit: "项任务入口",
      status: "configured",
      content: "可创建真实仿真任务，结果需外部求解器返回",
    }),
    createControlledToolRecord({
      id: "csgpt-session-file-rag",
      name: "会话文件知识",
      enabled: input.sessionFileRagEnabled,
      count: input.sessionFileSources.length,
      unit: "个附件来源",
    }),
    createControlledToolRecord({
      id: "csgpt-user-file-rag",
      name: "用户文件知识",
      enabled: input.userFileRagEnabled,
      count: input.userFileSources.length,
      unit: "个附件来源",
    }),
  ];

  return records.filter(Boolean) as ControlledToolRecord[];
}

async function handle(req: NextRequest, { params }: { params: RouteParams }) {
  const { provider, path: pathSegments } = params;
  const rawPath = pathSegments.join("/");

  const config = getServerSideConfig();

  // 根据 Provider 获取对应的后端配置
  const backend = getBackendConfig(provider, config);
  if (!backend) {
    return NextResponse.json(
      { error: true, message: `不支持的 Provider: ${provider}` },
      { status: 400 },
    );
  }

  // 兼容 v1/ 前缀：v1/chat/completions → chat/completions
  const pathStr = rawPath.startsWith("v1/") ? rawPath.slice(3) : rawPath;

  // 处理 models 列表请求
  if (pathStr === "models" || req.url.includes("/models")) {
    return handleModelsRequest(provider, config, backend);
  }

  // 处理 chat/completions 请求
  if (pathStr === "chat/completions" || pathStr.endsWith("/chat/completions")) {
    return handleChatCompletions(req, provider, config, backend);
  }

  // 通用代理：转发其他请求到后端
  return handleGenericProxy(req, backend, pathStr);
}

// 后端配置类型
interface BackendConfig {
  baseUrl: string;
  apiKey: string;
  isCSGPT: boolean;
}

// 根据 Provider 获取后端配置
function getBackendConfig(
  provider: string,
  config: ReturnType<typeof getServerSideConfig>,
): BackendConfig | null {
  switch (provider) {
    case "csgpt":
      return {
        baseUrl: config.csgptBaseUrl || "",
        apiKey: config.csgptApiKey || "",
        isCSGPT: true,
      };
    case "openai":
      return {
        baseUrl: config.baseUrl
          ? ensureOpenAIBaseUrl(config.baseUrl)
          : "https://api.openai.com/v1",
        apiKey: config.apiKey || "",
        isCSGPT: false,
      };
    case "azure":
      return {
        baseUrl: config.azureUrl || "",
        apiKey: config.azureApiKey || "",
        isCSGPT: false,
      };
    case "anthropic":
      return {
        baseUrl: config.anthropicUrl || "https://api.anthropic.com",
        apiKey: config.anthropicApiKey || "",
        isCSGPT: false,
      };
    case "google":
      return {
        baseUrl:
          config.googleUrl || "https://generativelanguage.googleapis.com",
        apiKey: config.googleApiKey || "",
        isCSGPT: false,
      };
    case "deepseek":
      return {
        baseUrl: config.deepseekUrl || "https://api.deepseek.com",
        apiKey: config.deepseekApiKey || "",
        isCSGPT: false,
      };
    case "moonshot":
      return {
        baseUrl: config.moonshotUrl || "https://api.moonshot.ai",
        apiKey: config.moonshotApiKey || "",
        isCSGPT: false,
      };
    case "xai":
      return {
        baseUrl: config.xaiUrl || "https://api.x.ai",
        apiKey: config.xaiApiKey || "",
        isCSGPT: false,
      };
    case "chatglm":
      return {
        baseUrl: config.chatglmUrl || "https://open.bigmodel.cn",
        apiKey: config.chatglmApiKey || "",
        isCSGPT: false,
      };
    case "siliconflow":
      return {
        baseUrl: config.siliconFlowUrl || "https://api.siliconflow.cn",
        apiKey: config.siliconFlowApiKey || "",
        isCSGPT: false,
      };
    case "ai302":
    case "302ai":
      return {
        baseUrl: config.ai302Url || "https://api.302.ai",
        apiKey: config.ai302ApiKey || "",
        isCSGPT: false,
      };
    case "baidu":
      return {
        baseUrl: config.baiduUrl || "",
        apiKey: config.baiduApiKey || "",
        isCSGPT: false,
      };
    case "bytedance":
      return {
        baseUrl: config.bytedanceUrl || "",
        apiKey: config.bytedanceApiKey || "",
        isCSGPT: false,
      };
    case "alibaba":
      return {
        baseUrl: config.alibabaUrl || "https://dashscope.aliyuncs.com/api",
        apiKey: config.alibabaApiKey || "",
        isCSGPT: false,
      };
    case "tencent":
      return {
        baseUrl: config.tencentUrl || "",
        apiKey: config.tencentSecretKey || "",
        isCSGPT: false,
      };
    case "stability":
      return {
        baseUrl: config.stabilityUrl || "https://api.stability.ai",
        apiKey: config.stabilityApiKey || "",
        isCSGPT: false,
      };
    case "iflytek":
      return {
        baseUrl: config.iflytekUrl || "",
        apiKey: config.iflytekApiKey || "",
        isCSGPT: false,
      };
    default:
      return null;
  }
}

// 处理模型列表请求
async function handleModelsRequest(
  provider: string,
  config: ReturnType<typeof getServerSideConfig>,
  backend: BackendConfig,
) {
  if (provider === "csgpt") {
    const data = [
      {
        id: getPublicCSGPTModel(config),
        object: "model",
        created: Date.now(),
        owned_by: "csgpt",
        permission: [],
        root: getPublicCSGPTModel(config),
        parent: null,
      },
    ];
    for (const upstream of getVisibleDedicatedCSGPTUpstreams(config)) {
      data.push({
        id: upstream.model,
        object: "model",
        created: Date.now(),
        owned_by: "csgpt",
        permission: [],
        root: upstream.model,
        parent: null,
      });
    }
    return NextResponse.json({ object: "list", data });
  }

  // 其他 Provider：尝试转发 models 请求到后端
  try {
    const modelsUrl = joinUrl(backend.baseUrl, "models");
    const response = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${backend.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      return NextResponse.json({ object: "list", data: [] }, { status: 200 });
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ object: "list", data: [] }, { status: 200 });
  }
}

async function prepareProxyMessages(
  messages: any[],
  options: {
    injectCSGPTPrompt: boolean;
    ragKgEnabled: boolean;
    webSearchEnabled: boolean;
    academicSearchEnabled: boolean;
    designCalculationEnabled: boolean;
    structureVisualizationEnabled: boolean;
    simulationJobEnabled: boolean;
    sessionFileRagEnabled: boolean;
    sessionFileRecords: SessionFileRecord[];
    userFileRagEnabled: boolean;
    userFileExcludedFileIds: string[];
    userId?: string | null;
  },
) {
  const processedMessages = [...messages];
  const toolPlan = planControlledChatTools(processedMessages, {
    ragKgEnabled: options.ragKgEnabled,
    webSearchEnabled: options.webSearchEnabled,
    academicSearchEnabled: options.academicSearchEnabled,
    designCalculationEnabled: options.designCalculationEnabled,
    structureVisualizationEnabled: options.structureVisualizationEnabled,
    simulationJobEnabled: options.simulationJobEnabled,
    sessionFileRagEnabled: options.sessionFileRagEnabled,
    userFileRagEnabled: options.userFileRagEnabled,
  });
  const controlledAgentPlan = buildControlledAgentPlan(processedMessages, {
    ragKgEnabled: options.ragKgEnabled,
    webSearchEnabled: options.webSearchEnabled,
    academicSearchEnabled: options.academicSearchEnabled,
    designCalculationEnabled: options.designCalculationEnabled,
    structureVisualizationEnabled: options.structureVisualizationEnabled,
    simulationJobEnabled: options.simulationJobEnabled,
    sessionFileRagEnabled: options.sessionFileRagEnabled,
    userFileRagEnabled: options.userFileRagEnabled,
  });
  let ragKgSources: RagKgSource[] = [];
  let researchSources: ResearchSource[] = [];
  let designCalculations: DesignCalculationTrace[] = [];
  let structureVisualizations: StructureVisualizationTrace[] = [];
  let simulationJobDrafts: SimulationJobDraft[] = [];
  let simulationJobTaskCount = 0;
  let sessionFileSources: SessionFileSource[] = [];
  let userFileSources: UserFileSource[] = [];
  const contextBlocks: string[] = [];
  if (
    options.injectCSGPTPrompt &&
    !processedMessages.some((msg: any) => msg.role === "system")
  ) {
    processedMessages.unshift({
      role: "system",
      content: CSGPT_SYSTEM_PROMPT,
    });
  }

  if (toolPlan.ragKgEnabled) {
    const ragKgContext = await buildExternalRagKgContext(processedMessages);
    if (ragKgContext?.message) {
      ragKgSources = ragKgContext.sources;
      contextBlocks.push(`项目内部知识库上下文\n${ragKgContext.message}`);
    }
  }

  if (
    toolPlan.webSearchEnabled ||
    toolPlan.standardSearchEnabled ||
    toolPlan.patentSearchEnabled ||
    toolPlan.academicSearchEnabled
  ) {
    const researchContext = await buildExternalResearchContext(
      processedMessages,
      {
        webSearchEnabled:
          toolPlan.webSearchEnabled ||
          toolPlan.standardSearchEnabled ||
          toolPlan.patentSearchEnabled,
        academicSearchEnabled: toolPlan.academicSearchEnabled,
      },
    );
    if (researchContext?.message) {
      researchSources = researchContext.sources;
      contextBlocks.push(researchContext.message);
    }
  }

  if (toolPlan.designCalculationEnabled) {
    const calculationContext =
      buildExternalDesignCalculationContext(processedMessages);
    if (calculationContext?.message) {
      designCalculations = calculationContext.calculations;
      contextBlocks.push(calculationContext.message);
    }
  }

  if (toolPlan.structureVisualizationEnabled) {
    const visualizationContext =
      buildExternalStructureVisualizationContext(processedMessages);
    if (visualizationContext?.message) {
      structureVisualizations = visualizationContext.visualizations;
      contextBlocks.push(visualizationContext.message);
    }
  }

  if (toolPlan.simulationJobEnabled) {
    const simulationContext =
      buildExternalSimulationJobContext(processedMessages);
    if (simulationContext?.message) {
      simulationJobDrafts = simulationContext.drafts;
      simulationJobTaskCount = simulationContext.drafts.length;
      contextBlocks.push(simulationContext.message);
    }
  }

  if (toolPlan.sessionFileRagEnabled) {
    const sessionFileContext = buildSessionFileRagContext(
      processedMessages,
      options.sessionFileRecords,
    );
    if (sessionFileContext?.message) {
      sessionFileSources = sessionFileContext.sources;
      contextBlocks.push(sessionFileContext.message);
    }
  }

  if (toolPlan.userFileRagEnabled && options.userId) {
    const userFileContext = await buildUserFileRagContext(
      processedMessages,
      options.userId,
      options.userFileExcludedFileIds,
    );
    if (userFileContext?.message) {
      userFileSources = userFileContext.sources;
      contextBlocks.push(userFileContext.message);
    }
  }

  if (contextBlocks.length > 0) {
    let insertIndex = 0;
    while (
      insertIndex < processedMessages.length &&
      ["developer", "system"].includes(processedMessages[insertIndex]?.role)
    ) {
      insertIndex += 1;
    }
    processedMessages.splice(insertIndex, 0, {
      role: processedMessages.some(
        (message: any) => message.role === "developer",
      )
        ? "developer"
        : "system",
      content: contextBlocks.join("\n\n"),
    });
  }

  return {
    messages: processedMessages,
    ragKgSources,
    researchSources,
    designCalculations,
    structureVisualizations,
    simulationJobDrafts,
    sessionFileSources,
    userFileSources,
    controlledAgentPlan,
    controlledToolRecords: buildControlledToolRecords({
      ragKgEnabled: toolPlan.ragKgEnabled,
      ragKgSources,
      webSearchEnabled: toolPlan.webSearchEnabled,
      standardSearchEnabled: toolPlan.standardSearchEnabled,
      patentSearchEnabled: toolPlan.patentSearchEnabled,
      academicSearchEnabled: toolPlan.academicSearchEnabled,
      researchSources,
      designCalculationEnabled: toolPlan.designCalculationEnabled,
      designCalculations,
      structureVisualizationEnabled: toolPlan.structureVisualizationEnabled,
      structureVisualizations,
      simulationJobEnabled: toolPlan.simulationJobEnabled,
      simulationJobTaskCount,
      sessionFileRagEnabled: toolPlan.sessionFileRagEnabled,
      sessionFileSources,
      userFileRagEnabled: toolPlan.userFileRagEnabled,
      userFileSources,
    }),
  };
}

async function handleDedicatedCSGPTChatCompletions(
  config: ReturnType<typeof getServerSideConfig>,
  upstream: CSGPTUpstream,
  bodyData: {
    messages: any[];
    stream: boolean;
    model: string;
    rest: any;
    ragKgEnabled: boolean;
    webSearchEnabled: boolean;
    academicSearchEnabled: boolean;
    designCalculationEnabled: boolean;
    structureVisualizationEnabled: boolean;
    simulationJobEnabled: boolean;
    sessionFileRagEnabled: boolean;
    sessionFileRecords: SessionFileRecord[];
    userFileRagEnabled: boolean;
    userFileExcludedFileIds: string[];
    userId?: string | null;
  },
) {
  const {
    messages,
    stream,
    model,
    rest,
    ragKgEnabled,
    webSearchEnabled,
    academicSearchEnabled,
    designCalculationEnabled,
    structureVisualizationEnabled,
    simulationJobEnabled,
    sessionFileRagEnabled,
    sessionFileRecords,
    userFileRagEnabled,
    userFileExcludedFileIds,
    userId,
  } = bodyData;
  if (!upstream.baseUrl) {
    return NextResponse.json(
      { error: true, message: `${upstream.label} 后端地址未配置` },
      { status: 500 },
    );
  }
  const upstreamModel = resolveUpstreamCSGPTModel(model, config);

  let preparedMessages: Awaited<ReturnType<typeof prepareProxyMessages>>;
  try {
    preparedMessages = await prepareProxyMessages(messages, {
      injectCSGPTPrompt: true,
      ragKgEnabled,
      webSearchEnabled,
      academicSearchEnabled,
      designCalculationEnabled,
      structureVisualizationEnabled,
      simulationJobEnabled,
      sessionFileRagEnabled,
      sessionFileRecords,
      userFileRagEnabled,
      userFileExcludedFileIds,
      userId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: true, message: error?.message || "外部增强失败" },
      { status: 500 },
    );
  }

  const apiUrl = joinUrl(upstream.baseUrl, "chat/completions");
  const upstreamMessages = normalizeMessagesToText(preparedMessages.messages);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "CSGPT/1.0",
  };
  if (upstream.apiKey) {
    headers["Authorization"] = `Bearer ${upstream.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: upstreamModel,
        messages: upstreamMessages,
        stream,
        ...rest,
      }),
    });
  } catch (fetchError: any) {
    console.error(`[${upstream.label} API] 网络请求失败:`, fetchError.message);
    return NextResponse.json(
      {
        error: true,
        message: `无法连接到 ${upstream.label} 后端: ${fetchError.message}`,
      },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      {
        error: true,
        message: `${upstream.label} 后端错误: ${response.status}`,
        detail: errorText,
      },
      { status: response.status },
    );
  }

  if (stream && response.body) {
    const responseHeaders = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    attachRagKgSourcesHeader(responseHeaders, preparedMessages.ragKgSources);
    attachResearchSourcesHeader(
      responseHeaders,
      preparedMessages.researchSources,
    );
    attachDesignCalculationResultsHeader(
      responseHeaders,
      preparedMessages.designCalculations,
    );
    attachStructureVisualizationResultsHeader(
      responseHeaders,
      preparedMessages.structureVisualizations,
    );
    attachSimulationJobDraftsHeader(
      responseHeaders,
      preparedMessages.simulationJobDrafts,
    );
    attachSessionFileSourcesHeader(
      responseHeaders,
      preparedMessages.sessionFileSources,
    );
    attachUserFileSourcesHeader(
      responseHeaders,
      preparedMessages.userFileSources,
    );
    attachControlledAgentPlanHeader(
      responseHeaders,
      preparedMessages.controlledAgentPlan,
    );
    attachControlledToolRecordsHeader(
      responseHeaders,
      preparedMessages.controlledToolRecords,
    );
    return new Response(response.body, {
      status: 200,
      headers: responseHeaders,
    });
  }

  const data = await response.json();
  const nextResponse = NextResponse.json(data);
  attachRagKgSourcesHeader(nextResponse.headers, preparedMessages.ragKgSources);
  attachResearchSourcesHeader(
    nextResponse.headers,
    preparedMessages.researchSources,
  );
  attachDesignCalculationResultsHeader(
    nextResponse.headers,
    preparedMessages.designCalculations,
  );
  attachStructureVisualizationResultsHeader(
    nextResponse.headers,
    preparedMessages.structureVisualizations,
  );
  attachSimulationJobDraftsHeader(
    nextResponse.headers,
    preparedMessages.simulationJobDrafts,
  );
  attachSessionFileSourcesHeader(
    nextResponse.headers,
    preparedMessages.sessionFileSources,
  );
  attachUserFileSourcesHeader(
    nextResponse.headers,
    preparedMessages.userFileSources,
  );
  attachControlledAgentPlanHeader(
    nextResponse.headers,
    preparedMessages.controlledAgentPlan,
  );
  attachControlledToolRecordsHeader(
    nextResponse.headers,
    preparedMessages.controlledToolRecords,
  );
  return nextResponse;
}

// 处理聊天补全请求
async function handleChatCompletions(
  req: NextRequest,
  provider: string,
  config: ReturnType<typeof getServerSideConfig>,
  backend: BackendConfig,
) {
  const body = await req.json();
  const {
    messages,
    stream = true,
    model,
    external_rag_kg_enabled = false,
    external_web_search_enabled = false,
    external_academic_search_enabled = false,
    external_design_calculation_enabled = false,
    external_structure_visualization_enabled = false,
    external_simulation_job_enabled = false,
    external_session_file_rag_enabled = false,
    external_session_file_records = [],
    external_user_file_rag_enabled = false,
    external_user_file_excluded_file_ids = [],
    external_upstream_url,
    ...rest
  } = body;
  const ragKgEnabled = !!external_rag_kg_enabled;
  const webSearchEnabled = !!external_web_search_enabled;
  const academicSearchEnabled = !!external_academic_search_enabled;
  const designCalculationEnabled = !!external_design_calculation_enabled;
  const structureVisualizationEnabled =
    !!external_structure_visualization_enabled;
  const simulationJobEnabled = !!external_simulation_job_enabled;
  const sessionFileRagEnabled = !!external_session_file_rag_enabled;
  const userFileRagEnabled = !!external_user_file_rag_enabled;
  const sessionFileRecords = Array.isArray(external_session_file_records)
    ? external_session_file_records
    : [];
  const userFileExcludedFileIds = Array.isArray(
    external_user_file_excluded_file_ids,
  )
    ? external_user_file_excluded_file_ids
        .map((id: unknown) => String(id || "").trim())
        .filter(Boolean)
    : [];
  const externalEnhancementEnabled =
    ragKgEnabled ||
    webSearchEnabled ||
    academicSearchEnabled ||
    designCalculationEnabled ||
    structureVisualizationEnabled ||
    simulationJobEnabled ||
    sessionFileRagEnabled ||
    userFileRagEnabled;
  const preliminaryToolPlan = planControlledChatTools(messages, {
    ragKgEnabled,
    webSearchEnabled,
    academicSearchEnabled,
    designCalculationEnabled,
    structureVisualizationEnabled,
    simulationJobEnabled,
    sessionFileRagEnabled,
    userFileRagEnabled,
  });

  const userId = preliminaryToolPlan.userFileRagEnabled
    ? await getUserFromRequest(req)
    : null;
  if (preliminaryToolPlan.userFileRagEnabled && !userId) {
    return NextResponse.json(
      { error: true, message: "未授权" },
      { status: 401 },
    );
  }

  let customUpstreamBaseUrl = "";
  try {
    customUpstreamBaseUrl = externalEnhancementEnabled
      ? normalizeCustomUpstreamBaseUrl(external_upstream_url)
      : "";
  } catch (error: any) {
    return NextResponse.json(
      { error: true, message: error?.message || "自定义上游接口地址无效" },
      { status: 400 },
    );
  }

  const dedicatedUpstream = backend.isCSGPT
    ? getDedicatedCSGPTUpstream(model, config)
    : null;
  if (dedicatedUpstream) {
    return handleDedicatedCSGPTChatCompletions(config, dedicatedUpstream, {
      messages,
      stream,
      model,
      rest,
      ragKgEnabled,
      webSearchEnabled,
      academicSearchEnabled,
      designCalculationEnabled,
      structureVisualizationEnabled,
      simulationJobEnabled,
      sessionFileRagEnabled,
      sessionFileRecords,
      userFileRagEnabled,
      userFileExcludedFileIds,
      userId,
    });
  }

  let processedMessages = [...messages];
  let ragKgSources: RagKgSource[] = [];
  let researchSources: ResearchSource[] = [];
  let designCalculations: DesignCalculationTrace[] = [];
  let structureVisualizations: StructureVisualizationTrace[] = [];
  let simulationJobDrafts: SimulationJobDraft[] = [];
  let sessionFileSources: SessionFileSource[] = [];
  let userFileSources: UserFileSource[] = [];
  let controlledToolRecords: ControlledToolRecord[] = [];
  let controlledAgentPlan: ControlledAgentPlan | undefined;
  if (backend.isCSGPT || externalEnhancementEnabled) {
    try {
      const preparedMessages = await prepareProxyMessages(messages, {
        injectCSGPTPrompt: backend.isCSGPT,
        ragKgEnabled,
        webSearchEnabled,
        academicSearchEnabled,
        designCalculationEnabled,
        structureVisualizationEnabled,
        simulationJobEnabled,
        sessionFileRagEnabled,
        sessionFileRecords,
        userFileRagEnabled,
        userFileExcludedFileIds,
        userId,
      });
      processedMessages = preparedMessages.messages;
      ragKgSources = preparedMessages.ragKgSources;
      researchSources = preparedMessages.researchSources;
      designCalculations = preparedMessages.designCalculations;
      structureVisualizations = preparedMessages.structureVisualizations;
      simulationJobDrafts = preparedMessages.simulationJobDrafts;
      sessionFileSources = preparedMessages.sessionFileSources;
      userFileSources = preparedMessages.userFileSources;
      controlledToolRecords = preparedMessages.controlledToolRecords;
      controlledAgentPlan = preparedMessages.controlledAgentPlan;
    } catch (error: any) {
      return NextResponse.json(
        { error: true, message: error?.message || "外部增强失败" },
        { status: 500 },
      );
    }
  }

  const requestBody = {
    model: backend.isCSGPT ? resolveUpstreamCSGPTModel(model, config) : model,
    messages: backend.isCSGPT
      ? normalizeMessagesToText(processedMessages)
      : processedMessages,
    stream,
    ...rest,
  };

  const backendBaseUrl = customUpstreamBaseUrl || backend.baseUrl;
  if (!backendBaseUrl) {
    return NextResponse.json(
      { error: true, message: `${provider} 后端地址未配置` },
      { status: 500 },
    );
  }

  const apiUrl = joinUrl(backendBaseUrl, "chat/completions");

  const authHeader = customUpstreamBaseUrl
    ? req.headers.get("authorization") || ""
    : getAuthorizationHeader(req, backend.apiKey);
  const proxyHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader) {
    proxyHeaders["Authorization"] = authHeader;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: proxyHeaders,
      body: JSON.stringify(requestBody),
    });
  } catch (fetchError: any) {
    console.error(`[${provider} API] 网络请求失败:`, fetchError.message);
    return NextResponse.json(
      {
        error: true,
        message: `无法连接到后端服务: ${fetchError.message}`,
      },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[${provider} API] 后端错误:`, response.status, errorText);
    return NextResponse.json(
      {
        error: true,
        message: `后端服务返回错误: ${response.status}`,
        detail: errorText,
      },
      { status: response.status },
    );
  }

  if (stream && response.body) {
    // 直接透传上游 SSE 流，避免 TransformStream 在 Node.js 环境下导致流阻塞
    const responseHeaders = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    attachRagKgSourcesHeader(responseHeaders, ragKgSources);
    attachResearchSourcesHeader(responseHeaders, researchSources);
    attachDesignCalculationResultsHeader(responseHeaders, designCalculations);
    attachStructureVisualizationResultsHeader(
      responseHeaders,
      structureVisualizations,
    );
    attachSimulationJobDraftsHeader(responseHeaders, simulationJobDrafts);
    attachSessionFileSourcesHeader(responseHeaders, sessionFileSources);
    attachUserFileSourcesHeader(responseHeaders, userFileSources);
    attachControlledAgentPlanHeader(responseHeaders, controlledAgentPlan);
    attachControlledToolRecordsHeader(responseHeaders, controlledToolRecords);
    return new Response(response.body, {
      status: 200,
      headers: responseHeaders,
    });
  } else {
    const data = await response.json();
    const nextResponse = NextResponse.json(data);
    attachRagKgSourcesHeader(nextResponse.headers, ragKgSources);
    attachResearchSourcesHeader(nextResponse.headers, researchSources);
    attachDesignCalculationResultsHeader(
      nextResponse.headers,
      designCalculations,
    );
    attachStructureVisualizationResultsHeader(
      nextResponse.headers,
      structureVisualizations,
    );
    attachSimulationJobDraftsHeader(nextResponse.headers, simulationJobDrafts);
    attachSessionFileSourcesHeader(nextResponse.headers, sessionFileSources);
    attachUserFileSourcesHeader(nextResponse.headers, userFileSources);
    attachControlledAgentPlanHeader(nextResponse.headers, controlledAgentPlan);
    attachControlledToolRecordsHeader(
      nextResponse.headers,
      controlledToolRecords,
    );
    return nextResponse;
  }
}

// 通用代理处理
async function handleGenericProxy(
  req: NextRequest,
  backend: BackendConfig,
  pathStr: string,
) {
  try {
    if (!backend.baseUrl) {
      return NextResponse.json(
        { error: true, message: "后端地址未配置" },
        { status: 500 },
      );
    }

    const body = await req.text();
    const apiUrl = joinUrl(backend.baseUrl, pathStr);

    const response = await fetch(apiUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: getAuthorizationHeader(req, backend.apiKey),
      },
      body: body || undefined,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json(
      { error: true, message: "代理请求失败", detail: error.message },
      { status: 502 },
    );
  }
}

export const GET = handle;
export const POST = handle;

// 使用 Node.js Runtime，允许直接访问 IP 地址（Edge Runtime 禁止 IP 直连）
export const runtime = "nodejs";
