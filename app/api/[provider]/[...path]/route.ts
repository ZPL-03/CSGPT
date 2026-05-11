import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import {
  CSGPT_DEFAULT_MODEL,
  CSGPT_MODEL_2,
  CSGPT_MODEL_3,
} from "@/app/constant";
import { CSGPT_SYSTEM_PROMPT } from "@/app/prompts/csgpt";

// 通用 API 代理路由：处理 /api/{provider}/{...path} 请求
// 根据 Provider 将请求转发到对应的后端服务
const CS3_MAX_COMPLETION_TOKENS = 2048;

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

function isCS2Model(model: string): boolean {
  return model === CSGPT_MODEL_2;
}

function isCS3Model(model: string): boolean {
  return model === CSGPT_MODEL_3;
}

function resolveUpstreamCSGPTModel(
  requestedModel: string | undefined,
  config: ReturnType<typeof getServerSideConfig>,
) {
  const publicDefaultModel = getPublicCSGPTModel(config);

  // CS2 模型使用独立上游配置
  if (requestedModel && isCS2Model(requestedModel)) {
    return config.csgptCs2UpstreamModelName || requestedModel;
  }

  // CS3 模型使用独立上游配置
  if (requestedModel && isCS3Model(requestedModel)) {
    return config.csgptCs3UpstreamModelName || requestedModel;
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

function normalizeCS3GenerationOptions(rest: any) {
  const normalized = { ...rest };
  const maxTokenKeys = ["max_tokens", "max_completion_tokens"];
  let hasTokenLimit = false;

  for (const key of maxTokenKeys) {
    if (typeof normalized[key] === "number" && normalized[key] > 0) {
      normalized[key] = Math.min(normalized[key], CS3_MAX_COMPLETION_TOKENS);
      hasTokenLimit = true;
    }
  }

  if (!hasTokenLimit) {
    normalized.max_tokens = CS3_MAX_COMPLETION_TOKENS;
  }

  return normalized;
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
    // CS2 上游已配置时，返回 CS2 模型
    if (config.csgptCs2BaseUrl || config.csgptCs2ApiKey) {
      data.push({
        id: CSGPT_MODEL_2,
        object: "model",
        created: Date.now(),
        owned_by: "csgpt",
        permission: [],
        root: CSGPT_MODEL_2,
        parent: null,
      });
    }
    // CS3 上游已配置时，返回 CS3 模型
    if (config.csgptCs3BaseUrl || config.csgptCs3ApiKey) {
      data.push({
        id: CSGPT_MODEL_3,
        object: "model",
        created: Date.now(),
        owned_by: "csgpt",
        permission: [],
        root: CSGPT_MODEL_3,
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

// CS2 模型：转发到 OpenAI 格式接口
async function handleCS2ChatCompletions(
  config: ReturnType<typeof getServerSideConfig>,
  bodyData: { messages: any[]; stream: boolean; model: string; rest: any },
) {
  const { messages, stream, model, rest } = bodyData;
  const baseUrl = config.csgptCs2BaseUrl;
  if (!baseUrl) {
    return NextResponse.json(
      { error: true, message: "CS2 后端地址未配置" },
      { status: 500 },
    );
  }
  const apiKey = config.csgptCs2ApiKey || "";
  const upstreamModel = resolveUpstreamCSGPTModel(model, config);

  const processedMessages = [...messages];
  const hasSystemMessage = processedMessages.some(
    (msg: any) => msg.role === "system",
  );
  if (!hasSystemMessage) {
    processedMessages.unshift({
      role: "system",
      content: CSGPT_SYSTEM_PROMPT,
    });
  }

  const apiUrl = joinUrl(baseUrl, "chat/completions");
  const upstreamMessages = normalizeMessagesToText(processedMessages);

  const cs2Headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    cs2Headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: cs2Headers,
      body: JSON.stringify({
        model: upstreamModel,
        messages: upstreamMessages,
        stream,
        ...rest,
      }),
    });
  } catch (fetchError: any) {
    console.error("[CS2 API] 网络请求失败:", fetchError.message);
    return NextResponse.json(
      { error: true, message: `无法连接到 CS2 后端: ${fetchError.message}` },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      {
        error: true,
        message: `CS2 后端错误: ${response.status}`,
        detail: errorText,
      },
      { status: response.status },
    );
  }

  if (stream && response.body) {
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const data = await response.json();
  return NextResponse.json(data);
}

// CS3 模型：转发到 OpenAI 格式接口
async function handleCS3ChatCompletions(
  config: ReturnType<typeof getServerSideConfig>,
  bodyData: { messages: any[]; stream: boolean; model: string; rest: any },
) {
  const { messages, stream, model, rest } = bodyData;
  const generationOptions = normalizeCS3GenerationOptions(rest);
  const baseUrl = config.csgptCs3BaseUrl;
  if (!baseUrl) {
    return NextResponse.json(
      { error: true, message: "CS3 后端地址未配置" },
      { status: 500 },
    );
  }
  const apiKey = config.csgptCs3ApiKey || "";
  const upstreamModel = resolveUpstreamCSGPTModel(model, config);

  const processedMessages = [...messages];
  const hasSystemMessage = processedMessages.some(
    (msg: any) => msg.role === "system",
  );
  if (!hasSystemMessage) {
    processedMessages.unshift({
      role: "system",
      content: CSGPT_SYSTEM_PROMPT,
    });
  }

  const apiUrl = joinUrl(baseUrl, "chat/completions");
  const upstreamMessages = normalizeMessagesToText(processedMessages);

  const cs3Headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "CSGPT/1.0",
  };
  if (apiKey) {
    cs3Headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: cs3Headers,
      body: JSON.stringify({
        model: upstreamModel,
        messages: upstreamMessages,
        stream,
        ...generationOptions,
      }),
    });
  } catch (fetchError: any) {
    console.error("[CS3 API] 网络请求失败:", fetchError.message);
    return NextResponse.json(
      { error: true, message: `无法连接到 CS3 后端: ${fetchError.message}` },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      {
        error: true,
        message: `CS3 后端错误: ${response.status}`,
        detail: errorText,
      },
      { status: response.status },
    );
  }

  if (stream && response.body) {
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const data = await response.json();
  return NextResponse.json(data);
}

// 处理聊天补全请求
async function handleChatCompletions(
  req: NextRequest,
  provider: string,
  config: ReturnType<typeof getServerSideConfig>,
  backend: BackendConfig,
) {
  const body = await req.json();
  const { messages, stream = true, model, ...rest } = body;

  // CS2 模型：路由到独立上游
  if (backend.isCSGPT && model && isCS2Model(model)) {
    return handleCS2ChatCompletions(config, {
      messages,
      stream,
      model,
      rest,
    });
  }

  // CS3 模型：路由到独立上游
  if (backend.isCSGPT && model && isCS3Model(model)) {
    return handleCS3ChatCompletions(config, {
      messages,
      stream,
      model,
      rest,
    });
  }

  // CSGPT 专用：注入领域 System Prompt
  let processedMessages = [...messages];
  if (backend.isCSGPT) {
    const hasSystemMessage = processedMessages.some(
      (msg: any) => msg.role === "system",
    );
    if (!hasSystemMessage) {
      processedMessages.unshift({
        role: "system",
        content: CSGPT_SYSTEM_PROMPT,
      });
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

  if (!backend.baseUrl) {
    return NextResponse.json(
      { error: true, message: `${provider} 后端地址未配置` },
      { status: 500 },
    );
  }

  const apiUrl = joinUrl(backend.baseUrl, "chat/completions");

  const authHeader = getAuthorizationHeader(req, backend.apiKey);
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
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } else {
    const data = await response.json();
    return NextResponse.json(data);
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
