"use client";
// Azure 与 OpenAI 使用相同的模型协议，共用同一个 LLMApi 实现。
import {
  ApiPath,
  OPENAI_BASE_URL,
  DEFAULT_MODELS,
  OpenaiPath,
  Azure,
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
  uploadFile,
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
} from "../api";
import Locale from "../../locales";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  isDalle3 as _isDalle3,
  getTimeoutMSByModel,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";
import { prettyObject } from "@/app/utils/format";
import { stripThinkingContent } from "@/app/utils/thinking";
import {
  collectFileIdsFromSessionRecords,
  extractFileIdsFromMessageContent,
  uniqueFileIds,
} from "@/app/utils/file-context-ids";
import type { CSGPTDesignArtifactChunk } from "@/app/utils/structured-design";

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
  chat_template_kwargs?: Record<string, unknown>;
  csgpt_internal_knowledge_enabled?: boolean;
  csgpt_web_search_enabled?: boolean;
  csgpt_academic_search_enabled?: boolean;
  csgpt_session_file_knowledge_enabled?: boolean;
  csgpt_session_file_records?: {
    messageId?: string;
    role?: string;
    fileContent?: string;
    fileIds?: string[];
  }[];
  csgpt_user_file_knowledge_enabled?: boolean;
  csgpt_user_file_excluded_file_ids?: string[];
  csgpt_upstream_url?: string;
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

  // providerName 表示会话级 Provider，空值使用全局默认 Provider。
  path(path: string, providerName?: string, forceServerProxy = false): string {
    const accessStore = useAccessStore.getState();
    const effectiveProvider =
      providerName ||
      useAppConfig.getState().modelConfig.providerName ||
      ServiceProvider.CSGPT;
    const isApp = !!getClientConfig()?.isApp;

    // 当前 Provider 的 API 基础路径
    let baseUrl = this.getProviderBaseUrl(
      effectiveProvider,
      accessStore,
      isApp,
      forceServerProxy,
    );

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }

    const normalizedPath = this.normalizeRequestPath(baseUrl, path);

    return [baseUrl, normalizedPath].join("/");
  }

  private normalizeRequestPath(baseUrl: string, path: string): string {
    const isServerProxy = baseUrl.startsWith("/api/");
    if (!isServerProxy && baseUrl.endsWith("/v1") && path.startsWith("v1/")) {
      return path.slice(3);
    }

    return path;
  }

  // Provider API 基础 URL
  private getProviderBaseUrl(
    providerName: string,
    accessStore: ReturnType<typeof useAccessStore.getState>,
    isApp: boolean,
    forceServerProxy = false,
  ): string {
    const customProviderUrl =
      !forceServerProxy && accessStore.useCustomConfig
        ? this.getCustomProviderUrl(accessStore, providerName)
        : "";

    if (customProviderUrl) {
      return customProviderUrl;
    }

    // Provider 默认 API 路径；非 APP 模式走服务端代理，APP 模式走远程地址。
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

    // 未匹配 Provider 使用 OpenAI 兼容代理路径。
    return ApiPath.OpenAI;
  }

  // 用户自定义 Provider URL
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
    // dall-e-3 模型返回 URL，使用 URL 创建图片消息
    if (res.data) {
      let url = res.data?.at(0)?.url ?? "";
      const b64_json = res.data?.at(0)?.b64_json ?? "";
      if (!url && b64_json) {
        url = await uploadFile(
          base64Image2Blob(b64_json, "image/png"),
          "generated-image.png",
        );
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

  async chat(options: ChatOptions) {
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...options.config,
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
        // DALL-E 3 图片使用 b64_json，生成结果写入服务端文件表。
        response_format: "b64_json",
        n: 1,
        size: options.config?.size ?? "1024x1024",
        quality: options.config?.quality ?? "standard",
        style: options.config?.style ?? "vivid",
      };
    } else {
      const messages: ChatOptions["messages"] = [];
      const sessionFileRecords: NonNullable<
        RequestPayload["csgpt_session_file_records"]
      > = options.sessionFileRecords ? [...options.sessionFileRecords] : [];
      const messageFileIds: string[] = [];
      for (const v of options.messages) {
        let fileContent = (v as ChatMessage).fileContent;
        const currentMessageFileIds = extractFileIdsFromMessageContent(
          v.content,
        );
        messageFileIds.push(...currentMessageFileIds);
        if (fileContent && !options.sessionFileRecords) {
          sessionFileRecords.push({
            messageId: (v as ChatMessage).id,
            role: v.role,
            fileContent,
            fileIds: currentMessageFileIds,
          });
        }
        const messageContent = Array.isArray(v.content)
          ? v.content.map((part) =>
              part.type === "text"
                ? { ...part, text: stripThinkingContent(part.text ?? "") }
                : part,
            )
          : stripThinkingContent(v.content);
        const standardContent = Array.isArray(messageContent)
          ? messageContent.filter((part) => part.type !== "file_url")
          : messageContent;

        let content = await preProcessImageContent(standardContent);
        if (fileContent) {
          content =
            typeof content === "string"
              ? fileContent + "\n\n" + content
              : [{ type: "text", text: fileContent }, ...content];
        }
        if (!(isO1OrO3 && v.role === "system")) {
          const requestMessage = { role: v.role, content } as any;
          if (typeof (v as any)._csgptContextPriority === "number") {
            requestMessage._csgptContextPriority = (
              v as any
            )._csgptContextPriority;
          }
          messages.push(requestMessage);
        }
      }

      // O1 系列模型的协议不包含图片、工具调用、system 角色、流式和 temperature 等参数。
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
      if (modelConfig.enableRagKg) {
        requestPayload.csgpt_internal_knowledge_enabled = true;
      }
      if (modelConfig.enableWebSearch) {
        requestPayload.csgpt_web_search_enabled = true;
      }
      if (modelConfig.enableAcademicSearch) {
        requestPayload.csgpt_academic_search_enabled = true;
      }
      if (modelConfig.enableSessionFileRag) {
        requestPayload.csgpt_session_file_knowledge_enabled = true;
        requestPayload.csgpt_session_file_records = sessionFileRecords;
      }
      if (modelConfig.enableUserFileRag) {
        requestPayload.csgpt_user_file_knowledge_enabled = true;
        const excludedFileIds = uniqueFileIds([
          ...messageFileIds,
          ...collectFileIdsFromSessionRecords(sessionFileRecords),
        ]);
        if (excludedFileIds.length) {
          requestPayload.csgpt_user_file_excluded_file_ids = excludedFileIds;
        }
      }
      if (
        modelConfig.enableRagKg ||
        modelConfig.enableWebSearch ||
        modelConfig.enableAcademicSearch ||
        modelConfig.enableSessionFileRag ||
        modelConfig.enableUserFileRag
      ) {
        const customUpstreamUrl = useAccessStore.getState().useCustomConfig
          ? this.getCustomProviderUrl(
              useAccessStore.getState(),
              modelConfig.providerName,
            )
          : "";
        if (customUpstreamUrl) {
          requestPayload.csgpt_upstream_url = customUpstreamUrl;
        }
      }
      if (options.config.chat_template_kwargs) {
        requestPayload.chat_template_kwargs =
          options.config.chat_template_kwargs;
      }

      if (isGpt5) {
        // GPT-5 的输出预算字段是 max_completion_tokens。
        delete requestPayload.max_tokens;
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      } else if (isO1OrO3) {
        // o1/o3 使用 developer 消息启用格式化输出。
        // 参考: https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning
        requestPayload["messages"].unshift({
          role: "developer",
          content: "Formatting re-enabled",
        });

        // o1/o3 的输出预算字段是 max_completion_tokens。
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      }
    }

    const shouldStream = !isDalle3 && !!options.config.stream;
    const forceServerProxyForCsgptTools =
      !isDalle3 &&
      !!(
        modelConfig.enableRagKg ||
        modelConfig.enableWebSearch ||
        modelConfig.enableAcademicSearch ||
        modelConfig.enableSessionFileRag ||
        modelConfig.enableUserFileRag
      );
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      let chatPath = "";
      if (modelConfig.providerName === ServiceProvider.Azure) {
        // 查找模型，获取 displayName 作为 Azure 部署名
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
          forceServerProxyForCsgptTools,
        );
      } else {
        chatPath = this.path(
          isDalle3 ? OpenaiPath.ImagePath : OpenaiPath.ChatPath,
          modelConfig.providerName,
          forceServerProxyForCsgptTools,
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
            const json = JSON.parse(text);
            const designArtifact = json.csgpt_design_artifact;
            const designArtifactChunk = json.csgpt_design_artifact_chunk as
              | CSGPTDesignArtifactChunk
              | undefined;
            if (json.error) {
              return {
                isThinking: false,
                content: prettyObject({
                  error: true,
                  message: json.error.message || String(json.error),
                }),
                designArtifact,
                designArtifactChunk,
              };
            }
            const choices = json.choices as Array<{
              finish_reason?: string | null;
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
              };
            }>;

            const finishReason = choices?.[0]?.finish_reason;
            if (!choices?.length) {
              return {
                isThinking: false,
                content: "",
                finishReason,
                designArtifact,
                designArtifactChunk,
              };
            }

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

            // 跳过 content 和 reasoning_content 均为空的情况
            if (
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
                finishReason,
                designArtifact,
                designArtifactChunk,
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: true,
                content: reasoning,
                finishReason,
                designArtifact,
                designArtifactChunk,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
                finishReason,
                designArtifact,
                designArtifactChunk,
              };
            }

            return {
              isThinking: false,
              content: "",
              finishReason,
              designArtifact,
              designArtifactChunk,
            };
          },
          // 处理工具消息：将 tool_calls 消息和工具调用结果合并到请求中
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // 重置工具调用索引
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

        // 非流式请求
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = await this.extractMessage(resJson);
        options.onFinish(message, res, {
          finishReason: resJson?.choices?.[0]?.finish_reason,
          designArtifact: resJson?.csgpt_design_artifact,
        });
      }
    } catch (e) {
      console.error("[Request] failed to make a chat request", e);
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
    if (!chatModels) {
      return [];
    }

    // OpenAI 模型列表默认使用内置清单。
    let seq = 1000; // 与 constant.ts 中的排序保持一致。
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
