import { ACCESS_CODE_PREFIX, ServiceProvider } from "../constant";
import {
  ChatMessage,
  ChatMessageTool,
  ModelType,
  useAccessStore,
  useAppConfig,
} from "../store";
import { ChatGPTApi, DalleRequestPayload } from "./platforms/openai";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export type ChatModel = ModelType;

export interface MultimodalContent {
  type: "text" | "image_url" | "file_url";
  text?: string;
  image_url?: {
    url: string;
    name?: string;
    size?: number;
    type?: string;
  };
  file_url?: {
    url: string;
    name: string;
    size: number;
    type?: string;
  };
}

export interface RequestMessage {
  role: MessageRole;
  content: string | MultimodalContent[];
}

export interface LLMConfig {
  model: string;
  providerName?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  size?: DalleRequestPayload["size"];
  quality?: DalleRequestPayload["quality"];
  style?: DalleRequestPayload["style"];
}

export interface ChatOptions {
  messages: RequestMessage[];
  config: LLMConfig;

  onUpdate?: (message: string, chunk: string) => void;
  onFinish: (message: string, responseRes: Response) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
  onBeforeTool?: (tool: ChatMessageTool) => void;
  onAfterTool?: (tool: ChatMessageTool) => void;
}

export interface LLMUsage {
  used: number;
  total: number;
}

export interface LLMModel {
  name: string;
  displayName?: string;
  available: boolean;
  provider: LLMModelProvider;
  sorted: number;
}

export interface LLMModelProvider {
  id: string;
  providerName: string;
  providerType: string;
  sorted: number;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;
  abstract usage(): Promise<LLMUsage>;
  abstract models(): Promise<LLMModel[]>;
}

export class ClientApi {
  public llm: LLMApi;

  constructor() {
    this.llm = new ChatGPTApi();
  }

  async share(_messages: ChatMessage[], _avatarUrl: string | null = null) {
    return undefined;
  }
}

export function getBearerToken(
  apiKey: string,
  noBearer: boolean = false,
): string {
  return validString(apiKey)
    ? `${noBearer ? "" : "Bearer "}${apiKey.trim()}`
    : "";
}

export function validString(x: string): boolean {
  return x?.length > 0;
}

// 根据当前 Provider 获取请求头，自动匹配对应的 API Key
export function getHeaders(
  ignoreHeaders: boolean = false,
  providerName?: string,
) {
  const accessStore = useAccessStore.getState();
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  const isEnabledAccessControl = accessStore.enabledAccessControl();

  const effectiveProviderName =
    providerName ||
    useAppConfig.getState().modelConfig.providerName ||
    ServiceProvider.CSGPT;
  const apiKey = getApiKeyForProvider(accessStore, effectiveProviderName);

  if (apiKey) {
    headers["Authorization"] = getBearerToken(apiKey);
  } else if (isEnabledAccessControl && validString(accessStore.accessCode)) {
    headers["Authorization"] = getBearerToken(
      ACCESS_CODE_PREFIX + accessStore.accessCode,
    );
  }

  return headers;
}

// 根据 Provider 名称获取对应的 API Key
function getApiKeyForProvider(
  accessStore: ReturnType<typeof useAccessStore.getState>,
  providerName: string,
): string {
  const keyMap: Record<string, string> = {
    CSGPT: accessStore.csgptApiKey,
    OpenAI: accessStore.openaiApiKey,
    Azure: accessStore.azureApiKey,
    Google: accessStore.googleApiKey,
    Anthropic: accessStore.anthropicApiKey,
    Baidu: accessStore.baiduApiKey,
    ByteDance: accessStore.bytedanceApiKey,
    Alibaba: accessStore.alibabaApiKey,
    Tencent: accessStore.tencentSecretKey,
    Moonshot: accessStore.moonshotApiKey,
    Iflytek: accessStore.iflytekApiKey,
    DeepSeek: accessStore.deepseekApiKey,
    XAI: accessStore.xaiApiKey,
    ChatGLM: accessStore.chatglmApiKey,
    Stability: accessStore.stabilityApiKey,
    SiliconFlow: accessStore.siliconflowApiKey,
    "302.AI": accessStore.ai302ApiKey,
  };
  return keyMap[providerName] || "";
}

export function getClientApi(_provider?: ServiceProvider): ClientApi {
  return new ClientApi();
}
