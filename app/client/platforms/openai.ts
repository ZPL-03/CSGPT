"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  OPENAI_BASE_URL,
  DEFAULT_MODELS,
  OpenaiPath,
  Azure,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
  CSGPT_BASE_URL,
} from "@/app/constant";
import {
  ChatMessage,
  ChatMessageTool,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "@/app/store";
import { collectModelsWithDefaultModel } from "@/app/utils/model";
import {
  preProcessImageContent,
  uploadImage,
  base64Image2Blob,
  streamWithThink,
} from "@/app/utils/chat";
import { ModelSize, DalleQuality, DalleStyle } from "@/app/typing";

import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  LLMUsage,
  MultimodalContent,
  SpeechOptions,
} from "../api";
import Locale from "../../locales";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  isVisionModel,
  isDalle3 as _isDalle3,
  getTimeoutMSByModel,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export interface RequestPayload {
  messages: {
    role: "developer" | "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
  stream?: boolean;
  model: string;
  temperature: number;
  presence_penalty: number;
  frequency_penalty: number;
  top_p: number;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export interface DalleRequestPayload {
  model: string;
  prompt: string;
  response_format: "url" | "b64_json";
  n: number;
  size: ModelSize;
  quality: DalleQuality;
  style: DalleStyle;
}

export class ChatGPTApi implements LLMApi {
  private disableListModels = true;

  // providerName 可选参数：chat 调用时传入会话级 provider，其他调用使用全局默认
  path(path: string, providerName?: string): string {
    const accessStore = useAccessStore.getState();
    const effectiveProvider =
      providerName ||
      useAppConfig.getState().modelConfig.providerName ||
      ServiceProvider.CSGPT;
    const isApp = !!getClientConfig()?.isApp;

    // 根据当前选中的 Provider 获取对应的 API 基础路径
    let baseUrl = this.getProviderBaseUrl(
      effectiveProvider,
      accessStore,
      isApp,
    );

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }

    const normalizedPath = this.normalizeRequestPath(baseUrl, path);

    console.log(
      "[Proxy Endpoint] Provider:",
      providerName,
      baseUrl,
      normalizedPath,
    );

    return [baseUrl, normalizedPath].join("/");
  }

  private normalizeRequestPath(baseUrl: string, path: string): string {
    const isServerProxy = baseUrl.startsWith("/api/");
    if (!isServerProxy && baseUrl.endsWith("/v1") && path.startsWith("v1/")) {
      return path.slice(3);
    }

    return path;
  }

  // 根据 Provider 获取对应的 API 基础 URL
  private getProviderBaseUrl(
    providerName: string,
    accessStore: ReturnType<typeof useAccessStore.getState>,
    isApp: boolean,
  ): string {
    const customProviderUrl = accessStore.useCustomConfig
      ? this.getCustomProviderUrl(accessStore, providerName)
      : "";

    if (customProviderUrl) {
      return customProviderUrl;
    }

    // 各 Provider 的默认 API 路径（非 APP 模式走服务端代理，APP 模式走远程地址）
    const urlMap: Record<string, string> = {
      [ServiceProvider.CSGPT]: CSGPT_BASE_URL,
      [ServiceProvider.OpenAI]: ApiPath.OpenAI,
      [ServiceProvider.Azure]: ApiPath.Azure,
      [ServiceProvider.Google]: ApiPath.Google,
      [ServiceProvider.Anthropic]: ApiPath.Anthropic,
      [ServiceProvider.Baidu]: ApiPath.Baidu,
      [ServiceProvider.ByteDance]: ApiPath.ByteDance,
      [ServiceProvider.Alibaba]: ApiPath.Alibaba,
      [ServiceProvider.Tencent]: ApiPath.Tencent,
      [ServiceProvider.Moonshot]: ApiPath.Moonshot,
      [ServiceProvider.Iflytek]: ApiPath.Iflytek,
      [ServiceProvider.DeepSeek]: ApiPath.DeepSeek,
      [ServiceProvider.XAI]: ApiPath.XAI,
      [ServiceProvider.ChatGLM]: ApiPath.ChatGLM,
      [ServiceProvider.SiliconFlow]: ApiPath.SiliconFlow,
      [ServiceProvider.Stability]: ApiPath.Stability,
      [ServiceProvider["302.AI"]]: ApiPath["302.AI"],
    };

    const baseUrl = urlMap[providerName];
    if (baseUrl) return baseUrl;

    // 使用 CSGPT 默认路径
    return CSGPT_BASE_URL;
  }

  // 获取用户自定义的 Provider URL
  private getCustomProviderUrl(
    accessStore: ReturnType<typeof useAccessStore.getState>,
    providerName: string,
  ): string {
    const customUrlMap: Record<string, string | undefined> = {
      [ServiceProvider.CSGPT]: accessStore.csgptUrl,
      [ServiceProvider.OpenAI]: accessStore.openaiUrl,
      [ServiceProvider.Azure]: accessStore.azureUrl,
      [ServiceProvider.Google]: accessStore.googleUrl,
      [ServiceProvider.Anthropic]: accessStore.anthropicUrl,
      [ServiceProvider.Baidu]: accessStore.baiduUrl,
      [ServiceProvider.ByteDance]: accessStore.bytedanceUrl,
      [ServiceProvider.Alibaba]: accessStore.alibabaUrl,
      [ServiceProvider.Tencent]: accessStore.tencentUrl,
      [ServiceProvider.Moonshot]: accessStore.moonshotUrl,
      [ServiceProvider.Iflytek]: accessStore.iflytekUrl,
      [ServiceProvider.DeepSeek]: accessStore.deepseekUrl,
      [ServiceProvider.XAI]: accessStore.xaiUrl,
      [ServiceProvider.ChatGLM]: accessStore.chatglmUrl,
      [ServiceProvider.SiliconFlow]: accessStore.siliconflowUrl,
      [ServiceProvider.Stability]: accessStore.stabilityUrl,
      [ServiceProvider["302.AI"]]: accessStore.ai302Url,
    };

    const customUrl = customUrlMap[providerName];
    if (customUrl && !customUrl.startsWith("/api/")) {
      return customUrl;
    }
    return "";
  }

  async extractMessage(res: any) {
    if (res.error) {
      return "```\n" + JSON.stringify(res, null, 4) + "\n```";
    }
    // dalle3 model return url, using url create image message
    if (res.data) {
      let url = res.data?.at(0)?.url ?? "";
      const b64_json = res.data?.at(0)?.b64_json ?? "";
      if (!url && b64_json) {
        // uploadImage
        url = await uploadImage(base64Image2Blob(b64_json, "image/png"));
      }
      return [
        {
          type: "image_url",
          image_url: {
            url,
          },
        },
      ];
    }
    // 推理模型可能仅返回 reasoning_content 而无 content（如 DeepSeek）
    const message = res.choices?.at(0)?.message;
    return message?.content || message?.reasoning_content || res;
  }

  async speech(options: SpeechOptions): Promise<ArrayBuffer> {
    const requestPayload = {
      model: options.model,
      input: options.input,
      voice: options.voice,
      response_format: options.response_format,
      speed: options.speed,
    };

    console.log("[Request] openai speech payload: ", requestPayload);

    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const speechPath = this.path(OpenaiPath.SpeechPath);
      const speechPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      const res = await fetch(speechPath, speechPayload);
      clearTimeout(requestTimeoutId);
      return await res.arrayBuffer();
    } catch (e) {
      console.log("[Request] failed to make a speech request", e);
      throw e;
    }
  }

  async chat(options: ChatOptions) {
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
    };

    let requestPayload: RequestPayload | DalleRequestPayload;

    const isDalle3 = _isDalle3(options.config.model);
    const isO1OrO3 =
      options.config.model.startsWith("o1") ||
      options.config.model.startsWith("o3") ||
      options.config.model.startsWith("o4-mini");
    const isGpt5 = options.config.model.startsWith("gpt-5");
    if (isDalle3) {
      const prompt = getMessageTextContent(
        options.messages.slice(-1)?.pop() as any,
      );
      requestPayload = {
        model: options.config.model,
        prompt,
        // URLs are only valid for 60 minutes after the image has been generated.
        response_format: "b64_json", // using b64_json, and save image in CacheStorage
        n: 1,
        size: options.config?.size ?? "1024x1024",
        quality: options.config?.quality ?? "standard",
        style: options.config?.style ?? "vivid",
      };
    } else {
      const visionModel = isVisionModel(options.config.model);
      const messages: ChatOptions["messages"] = [];
      for (const v of options.messages) {
        // 从上传文件中提取的文本（不显示在 UI 中，仅发送给模型）
        const fileContent = (v as ChatMessage).fileContent;
        // 从上传文档（docx/pdf）中提取的内嵌图片（不显示在 UI 中，仅发送给模型）
        const extractedImages = (v as ChatMessage).extractedImages;
        let content: string | MultimodalContent[];
        if (visionModel) {
          content = await preProcessImageContent(v.content);
          if (fileContent) {
            content =
              typeof content === "string"
                ? fileContent + "\n\n" + content
                : [{ type: "text", text: fileContent }, ...(content as any)];
          }
          // 将文档内嵌图片追加到多模态内容中
          if (extractedImages && extractedImages.length > 0) {
            const imageParts: MultimodalContent[] = extractedImages.map(
              (url) => ({ type: "image_url" as const, image_url: { url } }),
            );
            content =
              typeof content === "string"
                ? [{ type: "text" as const, text: content }, ...imageParts]
                : [...(content as MultimodalContent[]), ...imageParts];
          }
        } else if (typeof v.content === "string") {
          content = fileContent ? fileContent + "\n\n" + v.content : v.content;
        } else {
          // 非视觉模型：将多模态内容转为文本
          const textParts = v.content
            .map((part) => {
              if (part.type === "text") return part.text ?? "";
              if (part.type === "image_url") return "[图片]";
              if (part.type === "file_url")
                return `[文件: ${part.file_url?.name ?? "未知"}]`;
              return "";
            })
            .filter(Boolean)
            .join("\n");
          content = fileContent ? fileContent + "\n\n" + textParts : textParts;
        }
        if (!(isO1OrO3 && v.role === "system"))
          messages.push({ role: v.role, content });
      }

      // O1 not support image, tools (plugin in ChatGPTNextWeb) and system, stream, logprobs, temperature, top_p, n, presence_penalty, frequency_penalty yet.
      requestPayload = {
        messages,
        stream: options.config.stream,
        model: modelConfig.model,
        temperature: !isO1OrO3 && !isGpt5 ? modelConfig.temperature : 1,
        presence_penalty: !isO1OrO3 ? modelConfig.presence_penalty : 0,
        frequency_penalty: !isO1OrO3 ? modelConfig.frequency_penalty : 0,
        top_p: !isO1OrO3 ? modelConfig.top_p : 1,
        max_tokens: modelConfig.max_tokens,
      };

      if (isGpt5) {
        // Remove max_tokens if present
        delete requestPayload.max_tokens;
        // Add max_completion_tokens (or max_completion_tokens if that's what you meant)
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      } else if (isO1OrO3) {
        // by default the o1/o3 models will not attempt to produce output that includes markdown formatting
        // manually add "Formatting re-enabled" developer message to encourage markdown inclusion in model responses
        // (https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning?tabs=python-secure#markdown-output)
        requestPayload["messages"].unshift({
          role: "developer",
          content: "Formatting re-enabled",
        });

        // o1/o3 uses max_completion_tokens to control the number of tokens (https://platform.openai.com/docs/guides/reasoning#controlling-costs)
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      }

      // add max_tokens to vision model
      if (visionModel && !isO1OrO3 && !isGpt5) {
        requestPayload["max_tokens"] = Math.max(modelConfig.max_tokens, 4000);
      }
    }

    console.log("[Request] openai payload: ", requestPayload);

    const shouldStream = !isDalle3 && !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      let chatPath = "";
      if (modelConfig.providerName === ServiceProvider.Azure) {
        // find model, and get displayName as deployName
        const { models: configModels, customModels: configCustomModels } =
          useAppConfig.getState();
        const {
          defaultModel,
          customModels: accessCustomModels,
          useCustomConfig,
        } = useAccessStore.getState();
        const models = collectModelsWithDefaultModel(
          configModels,
          [configCustomModels, accessCustomModels].join(","),
          defaultModel,
        );
        const model = models.find(
          (model) =>
            model.name === modelConfig.model &&
            model?.provider?.providerName === ServiceProvider.Azure,
        );
        chatPath = this.path(
          (isDalle3 ? Azure.ImagePath : Azure.ChatPath)(
            (model?.displayName ?? model?.name) as string,
            useCustomConfig ? useAccessStore.getState().azureApiVersion : "",
          ),
          modelConfig.providerName,
        );
      } else {
        chatPath = this.path(
          isDalle3 ? OpenaiPath.ImagePath : OpenaiPath.ChatPath,
          modelConfig.providerName,
        );
      }
      if (shouldStream) {
        let index = -1;
        const tools: any[] = [];
        const funcs: Record<string, Function> = {};
        streamWithThink(
          chatPath,
          requestPayload,
          getHeaders(false, modelConfig.providerName),
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
              };
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                index += 1;
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }

            const reasoning = choices[0]?.delta?.reasoning_content;
            const content = choices[0]?.delta?.content;

            // Skip if both content and reasoning_content are empty or null
            if (
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: true,
                content: reasoning,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
              };
            }

            return {
              isThinking: false,
              content: "",
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // reset index value
            index = -1;
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const chatPayload = {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers: getHeaders(false, modelConfig.providerName),
        };

        // make a fetch request
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = await this.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  async usage() {
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
    const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = formatDate(startOfMonth);
    const endDate = formatDate(new Date(Date.now() + ONE_DAY));

    const [used, subs] = await Promise.all([
      fetch(
        this.path(
          `${OpenaiPath.UsagePath}?start_date=${startDate}&end_date=${endDate}`,
        ),
        {
          method: "GET",
          headers: getHeaders(),
        },
      ),
      fetch(this.path(OpenaiPath.SubsPath), {
        method: "GET",
        headers: getHeaders(),
      }),
    ]);

    if (used.status === 401) {
      throw new Error(Locale.Error.Unauthorized);
    }

    if (!used.ok || !subs.ok) {
      throw new Error("Failed to query usage from openai");
    }

    const response = (await used.json()) as {
      total_usage?: number;
      error?: {
        type: string;
        message: string;
      };
    };

    const total = (await subs.json()) as {
      hard_limit_usd?: number;
    };

    if (response.error && response.error.type) {
      throw Error(response.error.message);
    }

    if (response.total_usage) {
      response.total_usage = Math.round(response.total_usage) / 100;
    }

    if (total.hard_limit_usd) {
      total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
    }

    return {
      used: response.total_usage,
      total: total.hard_limit_usd,
    } as LLMUsage;
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return DEFAULT_MODELS.slice();
    }

    const res = await fetch(this.path(OpenaiPath.ListModelPath), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    const resJson = (await res.json()) as OpenAIListModelResponse;
    const chatModels = resJson.data?.filter(
      (m) => m.id.startsWith("gpt-") || m.id.startsWith("chatgpt-"),
    );
    console.log("[Models]", chatModels);

    if (!chatModels) {
      return [];
    }

    //由于目前 OpenAI 的 disableListModels 默认为 true，所以当前实际不会运行到这场
    let seq = 1000; //同 Constant.ts 中的排序保持一致
    return chatModels.map((m) => ({
      name: m.id,
      available: true,
      sorted: seq++,
      provider: {
        id: "openai",
        providerName: "OpenAI",
        providerType: "openai",
        sorted: 1,
      },
    }));
  }
}
export { OpenaiPath };
