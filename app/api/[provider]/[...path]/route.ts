import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { getUserFromRequest } from "@/app/lib/auth";
import {
  CSGPT_CONTEXT_LENGTH,
  CSGPT_DEFAULT_MODEL,
  CSGPT_MODEL_2,
  CSGPT_MODEL_3,
} from "@/app/constant";
import { CSGPT_SYSTEM_PROMPT } from "@/app/prompts/csgpt";
import { buildInternalKnowledgeContext } from "@/app/utils/server-rag-kg";
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
  buildDesignNarrativeInstruction,
  detectDeterministicDesignIntent,
  detectFEMReadyDesignIntent,
  renderDeterministicDesignAppendix,
  requestDeterministicDesign,
  type DesignServiceResponse,
} from "@/app/utils/server-deterministic-design";
import {
  CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD,
  CSGPT_DESIGN_ARTIFACT_FIELD,
  CSGPT_DESIGN_ARTIFACT_HEADER,
  encodeCSGPTDesignArtifactHeader,
  toCSGPTDesignArtifact,
  type CSGPTDesignArtifact,
} from "@/app/utils/structured-design";
import { applyCSGPTContextBudget } from "@/app/utils/csgpt-context-budget";
import {
  buildDeterministicLaminateAnalysis,
  detectLaminateAnalysisIntent,
} from "@/app/utils/server-laminate-analysis";

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
  contextLength: number;
};

const DEFAULT_CSGPT_CONTEXT_LENGTH = CSGPT_CONTEXT_LENGTH;
const DESIGN_NARRATIVE_MAX_TOKENS = 1600;
const SYNTHETIC_STREAM_CHUNK_CHARS = 1200;
const DESIGN_ARTIFACT_STREAM_CHUNK_CHARS = 12000;

function getDesignCompletionFinishReason(upstreamFinishReason: string | null) {
  // 确定性候选附录已经独立完整校验；上游 length 只表示说明文字达到预算。
  // 其他完成原因继续向客户端暴露，避免把上游异常静默转换为成功。
  return !upstreamFinishReason || upstreamFinishReason === "length"
    ? "stop"
    : upstreamFinishReason;
}

function buildSyntheticCSGPTStream(content: string, model: string) {
  const encoder = new TextEncoder();
  const completionId = `chatcmpl-csgpt-laminate-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          openAIStreamEvent({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: null,
              },
            ],
          }),
        ),
      );
      for (
        let offset = 0;
        offset < content.length;
        offset += SYNTHETIC_STREAM_CHUNK_CHARS
      ) {
        controller.enqueue(
          encoder.encode(
            openAIStreamEvent({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    content: content.slice(
                      offset,
                      offset + SYNTHETIC_STREAM_CHUNK_CHARS,
                    ),
                  },
                  finish_reason: null,
                },
              ],
            }),
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          openAIStreamEvent({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function buildSyntheticCSGPTCompletion(content: string, model: string) {
  return {
    id: `chatcmpl-csgpt-laminate-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

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
      contextLength: config.csgptCs2ContextLength,
    },
    [CSGPT_MODEL_3]: {
      label: "CS3",
      model: CSGPT_MODEL_3,
      baseUrl: config.csgptCs3BaseUrl,
      apiKey: config.csgptCs3ApiKey,
      upstreamModelName: config.csgptCs3UpstreamModelName,
      contextLength: config.csgptCs3ContextLength,
    },
  };

  return upstreams[model] ?? null;
}

function getCSGPTContextLength(
  model: string | undefined,
  config: ReturnType<typeof getServerSideConfig>,
) {
  if (model === CSGPT_MODEL_2) return config.csgptCs2ContextLength;
  if (model === CSGPT_MODEL_3) return config.csgptCs3ContextLength;
  return config.csgptContextLength || DEFAULT_CSGPT_CONTEXT_LENGTH;
}

function prepareDesignNarrativeMessages(messages: any[], instruction: string) {
  const result = [...messages];
  let insertIndex = 0;
  while (
    insertIndex < result.length &&
    ["developer", "system"].includes(result[insertIndex]?.role)
  ) {
    insertIndex += 1;
  }
  result.splice(insertIndex, 0, {
    role: "system",
    content: instruction,
    _csgptContextPriority: 80,
  });
  return result;
}

function prepareDesignNarrativeRest(rest: Record<string, any>) {
  const result = { ...rest };
  delete result.max_completion_tokens;
  result.max_tokens = DESIGN_NARRATIVE_MAX_TOKENS;
  const requestedTemperature = Number(rest.temperature);
  result.temperature = Number.isFinite(requestedTemperature)
    ? Math.min(Math.max(requestedTemperature, 0), 0.3)
    : 0.2;
  return result;
}

function openAIStreamEvent(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function appendDesignToOpenAIStream(
  upstreamBody: ReadableStream<Uint8Array>,
  appendix: string,
  model: string,
  designArtifact: CSGPTDesignArtifact,
) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const completionId = `chatcmpl-csgpt-design-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let upstreamFinishReason: string | null = null;
      const forwardEvent = (event: string) => {
        const lines = event.split(/\r?\n/).flatMap((line) => {
          if (line.trim() === "data: [DONE]") return [];
          if (!line.startsWith("data:")) return [line];
          const rawPayload = line.slice(5).trim();
          try {
            const payload = JSON.parse(rawPayload);
            if (Array.isArray(payload?.choices)) {
              payload.choices = payload.choices.map((choice: any) => {
                if (choice?.finish_reason) {
                  upstreamFinishReason = String(choice.finish_reason);
                }
                return choice;
              });
              return [`data: ${JSON.stringify(payload)}`];
            }
          } catch {
            // 非 JSON 数据保持上游原样；正式 OpenAI SSE 数据应为单行 JSON。
          }
          return [line];
        });
        if (lines.some((line) => line.trim())) {
          controller.enqueue(encoder.encode(`${lines.join("\n")}\n\n`));
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let separator = buffer.match(/\r?\n\r?\n/);
          while (separator?.index !== undefined) {
            const event = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            forwardEvent(event);
            separator = buffer.match(/\r?\n\r?\n/);
          }
          if (done) break;
        }
        if (buffer.trim()) forwardEvent(buffer);

        for (
          let offset = 0;
          offset < appendix.length;
          offset += SYNTHETIC_STREAM_CHUNK_CHARS
        ) {
          controller.enqueue(
            encoder.encode(
              openAIStreamEvent({
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: appendix.slice(
                        offset,
                        offset + SYNTHETIC_STREAM_CHUNK_CHARS,
                      ),
                    },
                    finish_reason: null,
                  },
                ],
              }),
            ),
          );
        }
        const serializedArtifact = JSON.stringify(designArtifact);
        const artifactChunkTotal = Math.ceil(
          serializedArtifact.length / DESIGN_ARTIFACT_STREAM_CHUNK_CHARS,
        );
        for (let index = 0; index < artifactChunkTotal; index += 1) {
          controller.enqueue(
            encoder.encode(
              openAIStreamEvent({
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: null,
                  },
                ],
                [CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD]: {
                  id: completionId,
                  index,
                  total: artifactChunkTotal,
                  data: serializedArtifact.slice(
                    index * DESIGN_ARTIFACT_STREAM_CHUNK_CHARS,
                    (index + 1) * DESIGN_ARTIFACT_STREAM_CHUNK_CHARS,
                  ),
                },
              }),
            ),
          );
        }
        controller.enqueue(
          encoder.encode(
            openAIStreamEvent({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason:
                    getDesignCompletionFinishReason(upstreamFinishReason),
                },
              ],
            }),
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function appendDesignToOpenAICompletion(
  data: any,
  appendix: string,
  designArtifact: CSGPTDesignArtifact,
) {
  const choice = data?.choices?.[0];
  if (
    !choice ||
    !choice.message ||
    typeof choice.message.content !== "string"
  ) {
    throw new Error("CS2 上游返回的非流式消息结构无效。");
  }
  return {
    ...data,
    [CSGPT_DESIGN_ARTIFACT_FIELD]: designArtifact,
    choices: data.choices.map((item: any, index: number) =>
      index === 0
        ? {
            ...item,
            message: {
              ...item.message,
              content: `${item.message.content}${appendix}`,
            },
            finish_reason: getDesignCompletionFinishReason(
              item.finish_reason || null,
            ),
          }
        : item,
    ),
  };
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

function buildControlledToolRecords(input: {
  ragKgEnabled: boolean;
  ragKgSources: RagKgSource[];
  webSearchEnabled: boolean;
  academicSearchEnabled: boolean;
  researchSources: ResearchSource[];
  sessionFileRagEnabled: boolean;
  sessionFileSources: SessionFileSource[];
  userFileRagEnabled: boolean;
  userFileSources: UserFileSource[];
}) {
  const webSourceCount = input.researchSources.filter(
    (source) => source.mode === "web",
  ).length;
  const standardSourceCount = input.researchSources.filter(
    (source) => source.mode === "standard",
  ).length;
  const patentSourceCount = input.researchSources.filter(
    (source) => source.mode === "patent",
  ).length;
  const academicSourceCount = input.researchSources.filter(
    (source) => source.mode === "academic",
  ).length;
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
      count: webSourceCount,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-standard-search",
      name: "标准/规范检索",
      enabled: standardSourceCount > 0,
      count: standardSourceCount,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-patent-search",
      name: "专利检索",
      enabled: patentSourceCount > 0,
      count: patentSourceCount,
      unit: "条来源",
    }),
    createControlledToolRecord({
      id: "csgpt-academic-search",
      name: "学术检索",
      enabled: input.academicSearchEnabled,
      count: academicSourceCount,
      unit: "条来源",
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
    sessionFileRagEnabled: boolean;
    sessionFileRecords: SessionFileRecord[];
    userFileRagEnabled: boolean;
    userFileExcludedFileIds: string[];
    userId?: string | null;
  },
) {
  const processedMessages = [...messages];
  let ragKgSources: RagKgSource[] = [];
  let researchSources: ResearchSource[] = [];
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
      _csgptContextPriority: 100,
    });
  }

  if (options.ragKgEnabled) {
    const ragKgContext = await buildInternalKnowledgeContext(processedMessages);
    if (ragKgContext?.message) {
      ragKgSources = ragKgContext.sources;
      contextBlocks.push(`项目内部知识库上下文\n${ragKgContext.message}`);
    }
  }

  if (options.webSearchEnabled || options.academicSearchEnabled) {
    const researchContext = await buildExternalResearchContext(
      processedMessages,
      {
        webSearchEnabled: options.webSearchEnabled,
        academicSearchEnabled: options.academicSearchEnabled,
      },
    );
    if (researchContext?.message) {
      researchSources = researchContext.sources;
      contextBlocks.push(researchContext.message);
    }
  }

  if (options.sessionFileRagEnabled) {
    const sessionFileContext = buildSessionFileRagContext(
      processedMessages,
      options.sessionFileRecords,
    );
    if (sessionFileContext?.message) {
      sessionFileSources = sessionFileContext.sources;
      contextBlocks.push(sessionFileContext.message);
    }
  }

  if (options.userFileRagEnabled && options.userId) {
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
      _csgptContextPriority: 20,
    });
  }

  return {
    messages: processedMessages,
    ragKgSources,
    researchSources,
    sessionFileSources,
    userFileSources,
    controlledToolRecords: buildControlledToolRecords({
      ragKgEnabled: options.ragKgEnabled,
      ragKgSources,
      webSearchEnabled: options.webSearchEnabled,
      academicSearchEnabled: options.academicSearchEnabled,
      researchSources,
      sessionFileRagEnabled: options.sessionFileRagEnabled,
      sessionFileSources,
      userFileRagEnabled: options.userFileRagEnabled,
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
  const designIntent =
    model === CSGPT_MODEL_2
      ? detectFEMReadyDesignIntent(messages) ||
        detectDeterministicDesignIntent(messages)
      : null;
  const laminateAnalysisIntent =
    model === CSGPT_MODEL_2 &&
    !designIntent &&
    detectLaminateAnalysisIntent(messages);
  if (laminateAnalysisIntent) {
    const content = buildDeterministicLaminateAnalysis(messages);
    const syntheticModel =
      resolveUpstreamCSGPTModel(model, config) || model || CSGPT_MODEL_2;
    const record = createControlledToolRecord({
      id: "csgpt-laminate-analysis",
      name: "层合板确定性事实核验",
      enabled: true,
      count: 1,
      unit: "个事实核验",
      content: "按显式物理层序列复核对称性、均衡性和 ABD 结论边界",
    });
    const controlledToolRecords = record ? [record] : [];
    if (stream) {
      const responseHeaders = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      attachControlledToolRecordsHeader(responseHeaders, controlledToolRecords);
      return new Response(buildSyntheticCSGPTStream(content, syntheticModel), {
        status: 200,
        headers: responseHeaders,
      });
    }
    const response = NextResponse.json(
      buildSyntheticCSGPTCompletion(content, syntheticModel),
    );
    attachControlledToolRecordsHeader(response.headers, controlledToolRecords);
    return response;
  }
  let designResponse: DesignServiceResponse | null = null;
  if (designIntent) {
    if (!config.csgptCs2DesignBaseUrl) {
      return NextResponse.json(
        {
          error: true,
          message: "CS2 确定性设计服务地址未配置，不能生成严格批量候选。",
        },
        { status: 500 },
      );
    }
    try {
      designResponse = await requestDeterministicDesign(designIntent, {
        baseUrl: config.csgptCs2DesignBaseUrl,
        apiKey: config.csgptCs2DesignApiKey,
      });
    } catch (error: any) {
      return NextResponse.json(
        {
          error: true,
          message: `确定性方案生成失败：${
            error?.message || "设计服务未返回有效结果"
          }`,
        },
        { status: 502 },
      );
    }
  }

  let preparedMessages: Awaited<ReturnType<typeof prepareProxyMessages>>;
  try {
    preparedMessages = await prepareProxyMessages(messages, {
      injectCSGPTPrompt: true,
      ragKgEnabled,
      webSearchEnabled,
      academicSearchEnabled,
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

  let requestMessages = preparedMessages.messages;
  let requestRest = rest;
  const controlledToolRecords = [...preparedMessages.controlledToolRecords];
  let designAppendix = "";
  let designArtifact: CSGPTDesignArtifact | null = null;
  if (designIntent && designResponse) {
    requestMessages = prepareDesignNarrativeMessages(
      requestMessages,
      buildDesignNarrativeInstruction(designIntent, designResponse),
    );
    requestRest = prepareDesignNarrativeRest(rest);
    designAppendix = renderDeterministicDesignAppendix(
      designIntent,
      designResponse,
    );
    designArtifact = toCSGPTDesignArtifact(
      designResponse as unknown as Record<string, unknown>,
    );
    const record = createControlledToolRecord({
      id: "csgpt-deterministic-design",
      name: "确定性方案生成",
      enabled: true,
      count: designIntent.candidateCount,
      unit: "组候选",
      content:
        designResponse.generation_mode === "fem_ready_cylindrical_shell"
          ? `FEM-ready 设计合同已生成并校验 ${designIntent.candidateCount} 组圆柱壳候选`
          : `确定性设计引擎 v${designResponse.engine_version} 已生成并校验 ${designIntent.candidateCount} 组概念候选`,
    });
    if (record) controlledToolRecords.push(record);
  }

  let budgetedRequest: ReturnType<typeof applyCSGPTContextBudget>;
  try {
    budgetedRequest = applyCSGPTContextBudget(
      requestMessages,
      requestRest,
      upstream.contextLength || DEFAULT_CSGPT_CONTEXT_LENGTH,
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error: true,
        message: error?.message || "CSGPT 请求输入超出上下文窗口",
      },
      { status: 400 },
    );
  }

  const apiUrl = joinUrl(upstream.baseUrl, "chat/completions");

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
        messages: normalizeMessagesToText(budgetedRequest.messages),
        stream,
        ...budgetedRequest.rest,
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

  if (stream) {
    if (!response.body) {
      return NextResponse.json(
        { error: true, message: `${upstream.label} 后端没有返回 SSE 响应体` },
        { status: 502 },
      );
    }
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
    attachSessionFileSourcesHeader(
      responseHeaders,
      preparedMessages.sessionFileSources,
    );
    attachUserFileSourcesHeader(
      responseHeaders,
      preparedMessages.userFileSources,
    );
    attachControlledToolRecordsHeader(responseHeaders, controlledToolRecords);
    const responseBody =
      designAppendix && designResponse && designArtifact
        ? appendDesignToOpenAIStream(
            response.body,
            designAppendix,
            model,
            designArtifact,
          )
        : response.body;
    if (designArtifact) {
      responseHeaders.set(
        CSGPT_DESIGN_ARTIFACT_HEADER,
        encodeCSGPTDesignArtifactHeader(designArtifact),
      );
    }
    return new Response(responseBody, {
      status: 200,
      headers: responseHeaders,
    });
  }

  let data = await response.json();
  if (designAppendix && designResponse && designArtifact) {
    try {
      data = appendDesignToOpenAICompletion(
        data,
        designAppendix,
        designArtifact,
      );
    } catch (error: any) {
      return NextResponse.json(
        { error: true, message: error?.message || "CS2 上游响应结构无效" },
        { status: 502 },
      );
    }
  }
  const nextResponse = NextResponse.json(data);
  if (designArtifact) {
    nextResponse.headers.set(
      CSGPT_DESIGN_ARTIFACT_HEADER,
      encodeCSGPTDesignArtifactHeader(designArtifact),
    );
  }
  attachRagKgSourcesHeader(nextResponse.headers, preparedMessages.ragKgSources);
  attachResearchSourcesHeader(
    nextResponse.headers,
    preparedMessages.researchSources,
  );
  attachSessionFileSourcesHeader(
    nextResponse.headers,
    preparedMessages.sessionFileSources,
  );
  attachUserFileSourcesHeader(
    nextResponse.headers,
    preparedMessages.userFileSources,
  );
  attachControlledToolRecordsHeader(
    nextResponse.headers,
    controlledToolRecords,
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
    csgpt_internal_knowledge_enabled = false,
    csgpt_web_search_enabled = false,
    csgpt_academic_search_enabled = false,
    csgpt_session_file_knowledge_enabled = false,
    csgpt_session_file_records = [],
    csgpt_user_file_knowledge_enabled = false,
    csgpt_user_file_excluded_file_ids = [],
    csgpt_upstream_url,
    ...rest
  } = body;
  const ragKgEnabled = !!csgpt_internal_knowledge_enabled;
  const webSearchEnabled = !!csgpt_web_search_enabled;
  const academicSearchEnabled = !!csgpt_academic_search_enabled;
  const sessionFileRagEnabled = !!csgpt_session_file_knowledge_enabled;
  const userFileRagEnabled = !!csgpt_user_file_knowledge_enabled;
  const sessionFileRecords = Array.isArray(csgpt_session_file_records)
    ? csgpt_session_file_records
    : [];
  const userFileExcludedFileIds = Array.isArray(
    csgpt_user_file_excluded_file_ids,
  )
    ? csgpt_user_file_excluded_file_ids
        .map((id: unknown) => String(id || "").trim())
        .filter(Boolean)
    : [];
  const csgptToolsEnabled =
    ragKgEnabled ||
    webSearchEnabled ||
    academicSearchEnabled ||
    sessionFileRagEnabled ||
    userFileRagEnabled;
  const userId = userFileRagEnabled ? await getUserFromRequest(req) : null;
  if (userFileRagEnabled && !userId) {
    return NextResponse.json(
      { error: true, message: "未授权" },
      { status: 401 },
    );
  }

  let customUpstreamBaseUrl = "";
  try {
    customUpstreamBaseUrl = csgptToolsEnabled
      ? normalizeCustomUpstreamBaseUrl(csgpt_upstream_url)
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
  let sessionFileSources: SessionFileSource[] = [];
  let userFileSources: UserFileSource[] = [];
  let controlledToolRecords: ControlledToolRecord[] = [];
  if (backend.isCSGPT || csgptToolsEnabled) {
    try {
      const preparedMessages = await prepareProxyMessages(messages, {
        injectCSGPTPrompt: backend.isCSGPT,
        ragKgEnabled,
        webSearchEnabled,
        academicSearchEnabled,
        sessionFileRagEnabled,
        sessionFileRecords,
        userFileRagEnabled,
        userFileExcludedFileIds,
        userId,
      });
      processedMessages = preparedMessages.messages;
      ragKgSources = preparedMessages.ragKgSources;
      researchSources = preparedMessages.researchSources;
      sessionFileSources = preparedMessages.sessionFileSources;
      userFileSources = preparedMessages.userFileSources;
      controlledToolRecords = preparedMessages.controlledToolRecords;
    } catch (error: any) {
      return NextResponse.json(
        { error: true, message: error?.message || "外部增强失败" },
        { status: 500 },
      );
    }
  }

  let requestMessages = backend.isCSGPT
    ? normalizeMessagesToText(processedMessages)
    : processedMessages;
  let requestRest = rest;
  if (backend.isCSGPT) {
    try {
      const budgetedRequest = applyCSGPTContextBudget(
        processedMessages,
        rest,
        getCSGPTContextLength(model, config),
      );
      requestMessages = normalizeMessagesToText(budgetedRequest.messages);
      requestRest = budgetedRequest.rest;
    } catch (error: any) {
      return NextResponse.json(
        {
          error: true,
          message: error?.message || "CSGPT 请求输入超出上下文窗口",
        },
        { status: 400 },
      );
    }
  }

  const requestBody = {
    model: backend.isCSGPT ? resolveUpstreamCSGPTModel(model, config) : model,
    messages: requestMessages,
    stream,
    ...requestRest,
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
    attachSessionFileSourcesHeader(responseHeaders, sessionFileSources);
    attachUserFileSourcesHeader(responseHeaders, userFileSources);
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
    attachSessionFileSourcesHeader(nextResponse.headers, sessionFileSources);
    attachUserFileSourcesHeader(nextResponse.headers, userFileSources);
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
