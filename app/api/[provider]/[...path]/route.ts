import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
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
    throw new Error("自定义 RAG/KG 上游接口地址不是有效 URL。");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("自定义 RAG/KG 上游接口地址只支持 HTTP 或 HTTPS。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("自定义 RAG/KG 上游接口地址不能包含用户名或密码。");
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
  options: { injectCSGPTPrompt: boolean; ragKgEnabled: boolean },
) {
  const processedMessages = [...messages];
  let ragKgSources: RagKgSource[] = [];
  if (
    options.injectCSGPTPrompt &&
    !processedMessages.some((msg: any) => msg.role === "system")
  ) {
    processedMessages.unshift({
      role: "system",
      content: CSGPT_SYSTEM_PROMPT,
    });
  }

  if (options.ragKgEnabled) {
    const ragKgContext = await buildExternalRagKgContext(processedMessages);
    if (ragKgContext?.message) {
      ragKgSources = ragKgContext.sources;
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
        content: ragKgContext.message,
      });
    }
  }

  return { messages: processedMessages, ragKgSources };
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
  },
) {
  const { messages, stream, model, rest, ragKgEnabled } = bodyData;
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
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: true, message: error?.message || "RAG/KG 检索增强失败" },
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
    return new Response(response.body, {
      status: 200,
      headers: responseHeaders,
    });
  }

  const data = await response.json();
  const nextResponse = NextResponse.json(data);
  attachRagKgSourcesHeader(nextResponse.headers, preparedMessages.ragKgSources);
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
    external_rag_kg_upstream_url,
    ...rest
  } = body;
  const ragKgEnabled = !!external_rag_kg_enabled;

  let customUpstreamBaseUrl = "";
  try {
    customUpstreamBaseUrl = ragKgEnabled
      ? normalizeCustomUpstreamBaseUrl(external_rag_kg_upstream_url)
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
    });
  }

  let processedMessages = [...messages];
  let ragKgSources: RagKgSource[] = [];
  if (backend.isCSGPT || ragKgEnabled) {
    try {
      const preparedMessages = await prepareProxyMessages(messages, {
        injectCSGPTPrompt: backend.isCSGPT,
        ragKgEnabled,
      });
      processedMessages = preparedMessages.messages;
      ragKgSources = preparedMessages.ragKgSources;
    } catch (error: any) {
      return NextResponse.json(
        { error: true, message: error?.message || "RAG/KG 检索增强失败" },
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
    return new Response(response.body, {
      status: 200,
      headers: responseHeaders,
    });
  } else {
    const data = await response.json();
    const nextResponse = NextResponse.json(data);
    attachRagKgSourcesHeader(nextResponse.headers, ragKgSources);
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
