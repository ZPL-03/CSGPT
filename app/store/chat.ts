import {
  getMessageTextContent,
  isDalle3,
  safeLocalStorage,
  trimTopic,
} from "../utils";
import {
  syncConversationToDB,
  deleteConversationFromDB,
  loadAllConversationsFromDB,
} from "../utils/conversation-sync";

import { indexedDBStorage } from "@/app/utils/indexedDB-storage";
import { useUserStore } from "./user";
import { nanoid } from "nanoid";
import type {
  ClientApi,
  LLMConfig,
  MultimodalContent,
  RequestMessage,
} from "../client/api";
import { getClientApi } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_MODELS,
  DEFAULT_SYSTEM_TEMPLATE,
  GEMINI_SUMMARIZE_MODEL,
  DEEPSEEK_SUMMARIZE_MODEL,
  KnowledgeCutOffDate,
  MCP_SYSTEM_TEMPLATE,
  MCP_TOOLS_TEMPLATE,
  ServiceProvider,
  StoreKey,
  SUMMARIZE_MODEL,
} from "../constant";
import Locale, { getLang } from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore } from "../utils/store";
import { estimateTokenLength } from "../utils/token";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { useAccessStore } from "./access";
import { collectModelsWithDefaultModel } from "../utils/model";
import { createEmptyMask, Mask } from "./mask";
import { executeMcpAction, getAllTools, isMcpEnabled } from "../mcp/actions";
import { extractMcpJson, isMcpJson } from "../mcp/utils";
import { stripThinkingContent } from "../utils/thinking";

const localStorage = safeLocalStorage();

export type ChatMessageTool = {
  id: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
  content?: string;
  isError?: boolean;
  errorMsg?: string;
};

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  tools?: ChatMessageTool[];
  isMcpResponse?: boolean;
  /** 从上传文件中提取的文本，发送给模型但不显示在 UI 中 */
  fileContent?: string;
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;

  memoryPrompt: string;
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
const TOPIC_MAX_LENGTH = 24;
const STORE_SCHEMA_VERSION = 1;
const TITLE_SOURCE_MAX_LENGTH = 2000;
const titleGenerationSessions = new Set<string>();
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});

function createEmptySession(): ChatSession {
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,

    mask: createEmptyMask(),
  };
}

function getSummarizeModel(
  currentModel: string,
  providerName: string,
): string[] {
  // GPT 系列摘要使用 4o-mini。
  if (currentModel.startsWith("gpt") || currentModel.startsWith("chatgpt")) {
    const configStore = useAppConfig.getState();
    const accessStore = useAccessStore.getState();
    const allModel = collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
    const summarizeModel = allModel.find(
      (m) => m.name === SUMMARIZE_MODEL && m.available,
    );
    if (summarizeModel) {
      return [
        summarizeModel.name,
        summarizeModel.provider?.providerName as string,
      ];
    }
  }
  if (currentModel.startsWith("gemini")) {
    return [GEMINI_SUMMARIZE_MODEL, ServiceProvider.Google];
  } else if (currentModel.startsWith("deepseek-")) {
    return [DEEPSEEK_SUMMARIZE_MODEL, ServiceProvider.DeepSeek];
  }

  return [currentModel, providerName];
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function getTitleSourceMessage(messages: ChatMessage[]) {
  return messages.find(
    (message) => message.role === "user" && !message.isError,
  );
}

function getTitleAttachmentNames(message: ChatMessage) {
  if (typeof message.content === "string") return [];

  return message.content
    .map((item) => item.file_url?.name || item.image_url?.name || "")
    .map((name) => name.trim())
    .filter(Boolean);
}

function buildTitleSourceText(message: ChatMessage, textLabel = "用户消息") {
  const text = stripThinkingContent(getMessageTextContent(message)).trim();
  const attachmentNames = getTitleAttachmentNames(message);
  const sections = [
    text ? `${textLabel}：${text}` : "",
    attachmentNames.length > 0 ? `附件名称：${attachmentNames.join("、")}` : "",
  ].filter(Boolean);

  return sections.join("\n").slice(0, TITLE_SOURCE_MAX_LENGTH).trim();
}

function buildTitlePromptMessage(sourceText: string) {
  return createMessage({
    role: "user",
    content: `${Locale.Store.Prompt.Topic}\n\n待命名内容：\n${sourceText}`,
    date: "",
  });
}

function buildInitialTitleRequestMessages(messages: ChatMessage[]) {
  const firstUserMessage = getTitleSourceMessage(messages);
  if (!firstUserMessage) return [];
  const sourceText = buildTitleSourceText(firstUserMessage);
  if (!sourceText) return [];

  return [buildTitlePromptMessage(sourceText)];
}

function buildConversationTitleRequestMessages(messages: ChatMessage[]) {
  const visibleMessages = messages.filter(
    (message) =>
      !message.isError && !message.streaming && message.role !== "system",
  );
  const sourceText = visibleMessages
    .map((message) => {
      const content = buildTitleSourceText(
        message,
        message.role === "assistant" ? "助手回复" : "用户消息",
      );
      if (!content) return "";
      return `${message.role === "assistant" ? "助手" : "用户"}：${content}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, TITLE_SOURCE_MAX_LENGTH)
    .trim();
  if (!sourceText) return [];

  return [buildTitlePromptMessage(sourceText)];
}

function normalizeGeneratedTitle(title: string) {
  const firstLine = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const normalized = trimTopic(
    (firstLine || "")
      .replace(/^#{1,6}\s*/, "")
      .replace(/^(?:标题|题目|对话标题|title)\s*[:：\-]\s*/i, "")
      .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
      .replace(/[。.!！?？,，;；:：]+$/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  if (Array.from(normalized).length > TOPIC_MAX_LENGTH) return DEFAULT_TOPIC;
  return normalized || DEFAULT_TOPIC;
}

function buildTitleRequestConfig(
  modelConfig: ModelConfig,
  model: string,
  providerName: string,
): LLMConfig {
  const { max_tokens, ...modelcfg } = modelConfig;
  const titleConfig: LLMConfig = {
    ...modelcfg,
    stream: false,
    model,
    providerName,
    enableRagKg: false,
  };

  if (providerName === ServiceProvider.CSGPT) {
    titleConfig.chat_template_kwargs = { enable_thinking: false };
  }

  return titleConfig;
}

function normalizeChatMessage(message: Partial<ChatMessage>): ChatMessage {
  return {
    ...createMessage({
      role: message.role ?? "user",
      content: message.content ?? "",
    }),
    ...message,
    id: message.id || nanoid(),
    role: message.role ?? "user",
    content: message.content ?? "",
    date: message.date || new Date().toLocaleString(),
    streaming: false,
  } as ChatMessage;
}

function normalizeSessionModelConfig(modelConfig: any) {
  const normalized = {
    ...useAppConfig.getState().modelConfig,
    ...(modelConfig || {}),
  };
  if (typeof normalized.max_tokens !== "number") {
    normalized.max_tokens = useAppConfig.getState().modelConfig.max_tokens;
  }
  return normalized;
}

function normalizeChatSession(session: Partial<ChatSession>): ChatSession {
  const base = createEmptySession();
  const mask = {
    ...base.mask,
    ...(session.mask || {}),
    modelConfig: normalizeSessionModelConfig(session.mask?.modelConfig),
    context: (session.mask?.context || []).map((message) =>
      normalizeChatMessage(message as Partial<ChatMessage>),
    ),
  };

  return {
    ...base,
    ...session,
    id: session.id || nanoid(),
    topic: session.topic || DEFAULT_TOPIC,
    messages: (session.messages || []).map((message) =>
      normalizeChatMessage(message),
    ),
    stat: session.stat || base.stat,
    lastUpdate: session.lastUpdate || Date.now(),
    lastSummarizeIndex: session.lastSummarizeIndex || 0,
    mask,
  };
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const cutoff =
    KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;
  // 从 DEFAULT_MODELS 中查找匹配的模型信息
  const modelInfo = DEFAULT_MODELS.find((m) => m.name === modelConfig.model);

  // 优先使用用户配置的 providerName，仅在未配置时从 DEFAULT_MODELS 推断
  let serviceProvider: string =
    modelConfig.providerName ||
    modelInfo?.provider.providerName ||
    ServiceProvider.OpenAI;

  const vars = {
    ServiceProvider: serviceProvider,
    cutoff,
    model: modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // 输入包含完整模板前缀时使用原始输入。
  if (input.startsWith(output)) {
    output = "";
  }

  // 模板必须包含 {{input}} 占位符
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // 确保值是字符串
  });

  return output;
}

async function getMcpSystemPrompt(): Promise<string> {
  const tools = await getAllTools();

  let toolsStr = "";

  tools.forEach((i) => {
    // 客户端未注册工具则跳过
    if (!i.tools) return;

    toolsStr += MCP_TOOLS_TEMPLATE.replace(
      "{{ clientId }}",
      i.clientId,
    ).replace(
      "{{ tools }}",
      i.tools.tools.map((p: object) => JSON.stringify(p, null, 2)).join("\n"),
    );
  });

  return MCP_SYSTEM_TEMPLATE.replace("{{ MCP_TOOLS }}", toolsStr);
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
  lastInput: "",
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      forkSession() {
        // 当前会话引用
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        // 深拷贝消息
        newSession.messages = currentSession.messages.map((msg) => ({
          ...msg,
          id: nanoid(), // 生成新的消息 ID
        }));
        newSession.mask = {
          ...currentSession.mask,
          modelConfig: {
            ...currentSession.mask.modelConfig,
          },
        };

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [newSession, ...state.sessions],
        }));
      },

      clearSessions() {
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
      },

      // 从服务器加载对话，完全替换本地数据
      async loadSessionsFromServer() {
        const serverSessions = await loadAllConversationsFromDB();
        get().replaceFromServer(serverSessions);
      },

      // 服务器数据完全替换本地存储，不做合并
      replaceFromServer(serverSessions: ChatSession[]) {
        const sessions: ChatSession[] = [];

        for (const ss of serverSessions) {
          const mask = ss.mask || createEmptyMask();
          if (ss.mask && typeof ss.mask === "object") {
            Object.assign(mask.modelConfig, (ss.mask as any).modelConfig || {});
          }
          sessions.push({
            ...createEmptySession(),
            id: ss.id,
            topic: ss.topic,
            memoryPrompt: ss.memoryPrompt,
            messages: ss.messages || [],
            lastUpdate: ss.lastUpdate || Date.now(),
            lastSummarizeIndex: ss.lastSummarizeIndex || 0,
            clearContextIndex: ss.clearContextIndex,
            stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
            mask,
          });
        }

        if (sessions.length === 0) {
          sessions.push(createEmptySession());
        }

        set({ sessions, currentSessionIndex: 0 });
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // 移动会话
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // 当前会话索引
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(mask?: Mask) {
        const session = createEmptySession();

        if (mask) {
          const config = useAppConfig.getState();
          const globalModelConfig = config.modelConfig;

          session.mask = {
            ...mask,
            modelConfig: {
              ...globalModelConfig,
              ...mask.modelConfig,
            },
          };
          session.topic = mask.name;
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      async deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const deleted = await deleteConversationFromDB(deletedSession.id);
        if (!deleted) {
          showToast("删除会话失败");
          return;
        }

        const sessions = get().sessions.slice();
        const deleteIndex = sessions.findIndex(
          (session) => session.id === deletedSession.id,
        );
        if (deleteIndex < 0) return;
        sessions.splice(deleteIndex, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(deleteIndex < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // 撤销删除操作所需的会话状态
        const restoreState = {
          currentSessionIndex: get().currentSessionIndex,
          sessions: get().sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set(() => restoreState);
              syncConversationToDB(deletedSession);
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message: ChatMessage, targetSession: ChatSession) {
        get().updateTargetSession(targetSession, (session) => {
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
        });

        get().updateStat(message, targetSession);

        get().checkMcpJson(message);

        get().summarizeSession(false, targetSession);

        // 同步到数据库
        syncConversationToDB(targetSession);
      },

      async onUserInput(
        content: string,
        attachments?: Array<{
          id?: string;
          url: string;
          name: string;
          size: number;
          type: string;
          status?: string;
          extractedText?: string;
        }>,
        isMcpResponse?: boolean,
        fileContentOverride?: string,
      ) {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;

        // MCP 响应不套用用户输入模板。
        const textContent = isMcpResponse
          ? content
          : fillTemplateWith(content, modelConfig);

        let mContent: string | MultimodalContent[] = textContent;
        if (!isMcpResponse && attachments && attachments.length > 0) {
          mContent = [
            ...(textContent
              ? [{ type: "text" as const, text: textContent }]
              : []),
            ...attachments.map((att) =>
              att.type.startsWith("image/")
                ? {
                    type: "image_url" as const,
                    image_url: {
                      url: att.url,
                      name: att.name,
                      size: att.size,
                      type: att.type,
                    },
                  }
                : {
                    type: "file_url" as const,
                    file_url: {
                      url: att.url,
                      name: att.name,
                      size: att.size,
                      type: att.type,
                    },
                  },
            ),
          ];
        }

        const attachmentFileContent =
          fileContentOverride ||
          (attachments || [])
            .map((att) =>
              att.extractedText
                ? `【文件：${att.name}】\n${att.extractedText}`
                : "",
            )
            .filter(Boolean)
            .join("\n\n") ||
          undefined;

        let userMessage: ChatMessage = createMessage({
          role: "user",
          content: mContent,
          isMcpResponse,
        });
        userMessage.fileContent = attachmentFileContent;

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
        });

        const previousMessages = session.messages.slice();
        const messageIndex = previousMessages.length + 1;

        // 先写入真实用户消息和 AI 占位消息，降低界面响应延迟。
        get().updateTargetSession(session, (session) => {
          session.messages = session.messages.concat([userMessage, botMessage]);
          session.lastUpdate = Date.now();
        });
        get().generateSessionTitle(false, session);
        await syncConversationToDB(session);

        try {
          const recentMessages =
            await get().getMessagesWithMemory(previousMessages);
          const sendMessages = recentMessages.concat(userMessage);
          const api: ClientApi = getClientApi(modelConfig.providerName);

          api.llm.chat({
            messages: sendMessages,
            config: { ...modelConfig, stream: true },
            onUpdate(message) {
              botMessage.streaming = true;
              if (message) {
                botMessage.content = message;
              }
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
              });
            },
            async onFinish(message) {
              botMessage.streaming = false;
              if (message) {
                botMessage.content = message;
                botMessage.date = new Date().toLocaleString();
                get().onNewMessage(botMessage, session);
              } else {
                get().updateTargetSession(session, (session) => {
                  session.messages = session.messages.concat();
                  session.lastUpdate = Date.now();
                });
                await syncConversationToDB(session);
              }
              ChatControllerPool.remove(session.id, botMessage.id);
            },
            onBeforeTool(tool: ChatMessageTool) {
              (botMessage.tools = botMessage?.tools || []).push(tool);
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
              });
            },
            onAfterTool(tool: ChatMessageTool) {
              botMessage?.tools?.forEach((t, i, tools) => {
                if (tool.id == t.id) {
                  tools[i] = { ...tool };
                }
              });
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
              });
            },
            onError(error) {
              const isAborted = error.message?.includes?.("aborted");
              botMessage.content +=
                "\n\n" +
                prettyObject({
                  error: true,
                  message: error.message,
                });
              botMessage.streaming = false;
              userMessage.isError = !isAborted;
              botMessage.isError = !isAborted;
              get().updateTargetSession(session, (session) => {
                session.messages = session.messages.concat();
                session.lastUpdate = Date.now();
              });
              syncConversationToDB(session);
              ChatControllerPool.remove(
                session.id,
                botMessage.id ?? messageIndex,
              );

              console.error("[Chat] 请求异常", error);
            },
            onController(controller) {
              // 控制器用于停止或重试。
              ChatControllerPool.addController(
                session.id,
                botMessage.id ?? messageIndex,
                controller,
              );
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          botMessage.content +=
            "\n\n" +
            prettyObject({
              error: true,
              message,
            });
          botMessage.streaming = false;
          userMessage.isError = true;
          botMessage.isError = true;
          get().updateTargetSession(session, (session) => {
            session.messages = session.messages.concat();
            session.lastUpdate = Date.now();
          });
          syncConversationToDB(session);
          ChatControllerPool.remove(session.id, botMessage.id ?? messageIndex);
          console.error("[Chat] 请求异常", error);
        }
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        if (session.memoryPrompt.length) {
          return {
            role: "system",
            content: Locale.Store.Prompt.History(session.memoryPrompt),
            date: "",
          } as ChatMessage;
        }
      },

      async getMessagesWithMemory(sourceMessages?: ChatMessage[]) {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = (sourceMessages ?? session.messages).slice();
        const totalMessageCount = messages.length;

        // 上下文预置提示词
        const contextPrompts = session.mask.context.slice();

        // 系统提示词，用于模拟 ChatGPT Web 体验
        const shouldInjectSystemPrompts =
          modelConfig.enableInjectSystemPrompts &&
          (session.mask.modelConfig.model.startsWith("gpt-") ||
            session.mask.modelConfig.model.startsWith("chatgpt-"));

        const mcpEnabled = await isMcpEnabled();
        const mcpSystemPrompt = mcpEnabled ? await getMcpSystemPrompt() : "";

        let systemPrompts: ChatMessage[] = [];

        if (shouldInjectSystemPrompts) {
          systemPrompts = [
            createMessage({
              role: "system",
              content:
                fillTemplateWith("", {
                  ...modelConfig,
                  template: DEFAULT_SYSTEM_TEMPLATE,
                }) + mcpSystemPrompt,
            }),
          ];
        } else if (mcpEnabled) {
          systemPrompts = [
            createMessage({
              role: "system",
              content: mcpSystemPrompt,
            }),
          ];
        }

        const memoryPrompt = get().getMemoryPrompt();
        // 长期记忆
        const shouldSendLongTermMemory =
          modelConfig.sendMemory &&
          session.memoryPrompt &&
          session.memoryPrompt.length > 0 &&
          session.lastSummarizeIndex > clearContextIndex;
        const longTermMemoryPrompts =
          shouldSendLongTermMemory && memoryPrompt ? [memoryPrompt] : [];
        const longTermMemoryStartIndex = session.lastSummarizeIndex;

        // 短期记忆（最近 N 条消息）
        const shortTermMemoryStartIndex = Math.max(
          0,
          totalMessageCount - modelConfig.historyMessageCount,
        );

        // 拼装发送消息，包含以下部分：
        // 0. 系统提示词
        // 1. 长期记忆：历史摘要消息
        // 2. 上下文预置提示词
        // 3. 短期记忆：最近 N 条消息
        // 4. 最新用户输入
        const memoryStartIndex = shouldSendLongTermMemory
          ? Math.min(longTermMemoryStartIndex, shortTermMemoryStartIndex)
          : shortTermMemoryStartIndex;
        // 如果用户清除了历史消息，同时排除记忆
        const contextStartIndex = Math.max(clearContextIndex, memoryStartIndex);
        const maxTokenThreshold = modelConfig.max_tokens;

        // 在 token 限制内尽可能多地获取最近消息
        const reversedRecentMessages = [];
        for (
          let i = totalMessageCount - 1, tokenCount = 0;
          i >= contextStartIndex && tokenCount < maxTokenThreshold;
          i -= 1
        ) {
          const msg = messages[i];
          if (!msg || msg.isError) continue;
          tokenCount += estimateTokenLength(getMessageTextContent(msg));
          reversedRecentMessages.push(msg);
        }
        // 拼接全部消息
        const recentMessages = [
          ...systemPrompts,
          ...longTermMemoryPrompts,
          ...contextPrompts,
          ...reversedRecentMessages.reverse(),
        ];

        return recentMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        set(() => ({ sessions }));
      },

      resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
      },

      generateSessionTitle(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        const config = useAppConfig.getState();
        const session = targetSession;
        const shouldGenerateTitle =
          refreshTitle ||
          (config.enableAutoGenerateTitle && session.topic === DEFAULT_TOPIC);
        if (!shouldGenerateTitle || titleGenerationSessions.has(session.id)) {
          return;
        }

        const modelConfig = session.mask.modelConfig;
        const titleMessages = refreshTitle
          ? buildConversationTitleRequestMessages(session.messages)
          : buildInitialTitleRequestMessages(session.messages);
        if (titleMessages.length === 0 || isDalle3(modelConfig.model)) {
          return;
        }

        titleGenerationSessions.add(session.id);

        const [model, providerName] = modelConfig.compressModel
          ? [modelConfig.compressModel, modelConfig.compressProviderName]
          : getSummarizeModel(
              session.mask.modelConfig.model,
              session.mask.modelConfig.providerName,
            );
        const api: ClientApi = getClientApi(providerName as ServiceProvider);
        api.llm.chat({
          messages: titleMessages,
          config: buildTitleRequestConfig(modelConfig, model, providerName),
          onFinish(message, responseRes) {
            titleGenerationSessions.delete(session.id);
            if (responseRes?.status !== 200) return;

            const topic = normalizeGeneratedTitle(message);
            if (topic === DEFAULT_TOPIC && !refreshTitle) return;

            get().updateTargetSession(session, (session) => {
              session.topic = topic;
              session.lastUpdate = Date.now();
            });
            const updated = get().sessions.find(
              (s: ChatSession) => s.id === session.id,
            );
            if (updated) syncConversationToDB(updated);
          },
          onError(err) {
            titleGenerationSessions.delete(session.id);
            console.error("[Title] ", err);
          },
        });
      },

      summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        get().generateSessionTitle(refreshTitle, session);

        // dall-e-3 模型跳过摘要
        if (isDalle3(modelConfig.model)) {
          return;
        }

        // 未配置压缩模型时使用默认摘要模型
        const [model, providerName] = modelConfig.compressModel
          ? [modelConfig.compressModel, modelConfig.compressProviderName]
          : getSummarizeModel(
              session.mask.modelConfig.model,
              session.mask.modelConfig.providerName,
            );
        const api: ClientApi = getClientApi(providerName as ServiceProvider);

        const messages = session.messages;
        const summarizeIndex = Math.max(
          session.lastSummarizeIndex,
          session.clearContextIndex ?? 0,
        );
        let toBeSummarizedMsgs = messages
          .filter((msg) => !msg.isError)
          .slice(summarizeIndex);

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (
          historyMsgLength >
          (modelConfig?.max_tokens ||
            useAppConfig.getState().modelConfig.max_tokens)
        ) {
          const n = toBeSummarizedMsgs.length;
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
            Math.max(0, n - modelConfig.historyMessageCount),
          );
        }
        const memoryPrompt = get().getMemoryPrompt();
        if (memoryPrompt) {
          // 添加记忆提示词
          toBeSummarizedMsgs.unshift(memoryPrompt);
        }

        const lastSummarizeIndex = session.messages.length;

        if (
          historyMsgLength > modelConfig.compressMessageLengthThreshold &&
          modelConfig.sendMemory
        ) {
          // 摘要请求不携带 max_tokens 参数。
          const { max_tokens, ...modelcfg } = modelConfig;
          api.llm.chat({
            messages: toBeSummarizedMsgs.concat(
              createMessage({
                role: "system",
                content: Locale.Store.Prompt.Summarize,
                date: "",
              }),
            ),
            config: {
              ...modelcfg,
              stream: true,
              model,
              providerName,
              enableRagKg: false,
            },
            onUpdate(message) {
              session.memoryPrompt = message;
            },
            onFinish(message, responseRes) {
              if (responseRes?.status === 200) {
                get().updateTargetSession(session, (session) => {
                  session.lastSummarizeIndex = lastSummarizeIndex;
                  session.memoryPrompt = message;
                });
                // 记忆内容写入数据库。
                const updated = get().sessions.find(
                  (s: ChatSession) => s.id === session.id,
                );
                if (updated) syncConversationToDB(updated);
              }
            },
            onError(err) {
              console.error("[Summarize] ", err);
            },
          });
        }
      },

      updateStat(message: ChatMessage, session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.stat.charCount += message.content.length;
        });
      },
      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        const sessions = [...get().sessions];
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index < 0) return;
        updater(sessions[index]);
        set(() => ({ sessions }));
      },
      async clearAllData() {
        // 服务端对话和文件数据
        const token = useUserStore.getState().token;
        if (token) {
          try {
            await fetch("/api/conversations", {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch {
            // 本地数据处理不依赖服务端响应。
          }
        }
        await indexedDBStorage.clear();
        // 对话数据独立于登录令牌和配置。
        const preservedKeys = [StoreKey.User, StoreKey.Access, StoreKey.Config];
        const preserved: Record<string, string | null> = {};
        for (const key of preservedKeys) {
          preserved[key] = localStorage.getItem(key);
        }
        localStorage.clear();
        for (const key of preservedKeys) {
          if (preserved[key]) {
            localStorage.setItem(key, preserved[key]!);
          }
        }
        location.reload();
      },
      setLastInput(lastInput: string) {
        set({
          lastInput,
        });
      },

      /** check if the message contains MCP JSON and execute the MCP action */
      checkMcpJson(message: ChatMessage) {
        const mcpEnabled = isMcpEnabled();
        if (!mcpEnabled) return;
        const content = getMessageTextContent(message);
        if (isMcpJson(content)) {
          try {
            const mcpRequest = extractMcpJson(content);
            if (mcpRequest) {
              executeMcpAction(mcpRequest.clientId, mcpRequest.mcp)
                .then((result) => {
                  const mcpResponse =
                    typeof result === "object"
                      ? JSON.stringify(result)
                      : String(result);
                  get().onUserInput(
                    `\`\`\`json:mcp-response:${mcpRequest.clientId}\n${mcpResponse}\n\`\`\``,
                    [],
                    true,
                  );
                })
                .catch((error) => showToast("MCP execution failed", error));
            }
          } catch (error) {
            console.error("[Check MCP JSON]", error);
          }
        }
      },
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: STORE_SCHEMA_VERSION,
    migrate(persistedState) {
      const state = persistedState as Partial<typeof DEFAULT_CHAT_STATE>;
      const newState = {
        ...DEFAULT_CHAT_STATE,
        ...JSON.parse(JSON.stringify(state || {})),
      } as typeof DEFAULT_CHAT_STATE;

      newState.sessions = (newState.sessions || []).map(
        (session: Partial<ChatSession>) => normalizeChatSession(session),
      );
      newState.currentSessionIndex = Math.min(
        Math.max(Number(newState.currentSessionIndex) || 0, 0),
        Math.max(newState.sessions.length - 1, 0),
      );
      newState.lastInput = newState.lastInput || "";

      return newState as any;
    },
  },
);
