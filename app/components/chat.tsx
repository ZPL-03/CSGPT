import { useDebouncedCallback } from "use-debounce";
import React, {
  Fragment,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import SendWhiteIcon from "../icons/send-white.svg";
import BrainIcon from "../icons/brain.svg";
import RenameIcon from "../icons/rename.svg";
import EditIcon from "../icons/rename.svg";
import ExportIcon from "../icons/share.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import PromptIcon from "../icons/prompt.svg";
import MaskIcon from "../icons/mask.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import ReloadIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import SettingsIcon from "../icons/chat-settings.svg";
import DeleteIcon from "../icons/clear.svg";
import PinIcon from "../icons/pin.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CloseIcon from "../icons/close.svg";
import CancelIcon from "../icons/cancel.svg";
import ImageIcon from "../icons/image.svg";
import GraphIcon from "../icons/graph.svg";
import SearchIcon from "../icons/search.svg";
import DownloadIcon from "../icons/download.svg";

import LightIcon from "../icons/light.svg";
import DarkIcon from "../icons/dark.svg";
import AutoIcon from "../icons/auto.svg";
import BottomIcon from "../icons/bottom.svg";
import StopIcon from "../icons/pause.svg";
import SizeIcon from "../icons/size.svg";
import QualityIcon from "../icons/hd.svg";
import StyleIcon from "../icons/palette.svg";
import ShortcutkeyIcon from "../icons/shortcutkey.svg";
import McpToolIcon from "../icons/tool.svg";
import {
  BOT_HELLO,
  ChatMessage,
  ChatSession,
  DEFAULT_TOPIC,
  ModelType,
  SubmitKey,
  Theme,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "../store";

import {
  autoGrowTextArea,
  copyToClipboard,
  downloadAs,
  getMessageFiles,
  getMessageImages,
  getMessageTextContent,
  isDalle3,
  safeLocalStorage,
  getModelSizes,
  supportsCustomSize,
  useMobileScreen,
  selectOrCopy,
} from "../utils";

import {
  uploadFile as uploadFileRemote,
  saveExtractedText,
} from "@/app/utils/chat";

import dynamic from "next/dynamic";

import { ChatControllerPool } from "../client/controller";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { Prompt, usePromptStore } from "../store/prompt";
import Locale from "../locales";

import { IconButton } from "./button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  Selector,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useNavigate } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  MAX_FILE_UPLOAD_SIZE,
  Path,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
  UNFINISHED_INPUT,
} from "../constant";
import { Avatar } from "./emoji";
import { ContextPrompts, MaskAvatar, MaskConfig } from "./mask";
import { useMaskStore } from "../store/mask";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { getClientConfig } from "../config/client";
import { syncConversationToDB } from "../utils/conversation-sync";
import { useAllModels } from "../utils/hooks";
import { ClientApi, MultimodalContent } from "../client/api";
import { useUserStore } from "../store/user";

import { isEmpty } from "lodash-es";
import {
  buildKnowledgeGraphConversationQuery,
  buildKnowledgeGraphPath,
  normalizeKnowledgeGraphQuery,
} from "../utils/knowledge-graph";
import { getModelProvider } from "../utils/model";
import clsx from "clsx";
import { getAvailableClientsCount, isMcpEnabled } from "../mcp/actions";

const localStorage = safeLocalStorage();

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

function getKnowledgeGraphQuery(
  session: { topic?: string; messages?: ChatMessage[] },
  input = "",
) {
  const currentInput = normalizeKnowledgeGraphQuery(input);
  if (currentInput) {
    return buildKnowledgeGraphConversationQuery([currentInput]) || currentInput;
  }
  const messages = session.messages || [];
  const recentUserTexts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const content = normalizeKnowledgeGraphQuery(
      getMessageTextContent(message),
    );
    if (content) recentUserTexts.push(content);
    const fileContent = normalizeKnowledgeGraphQuery(message.fileContent || "");
    if (!content && fileContent) recentUserTexts.push(fileContent);
    if (recentUserTexts.length >= 6) break;
  }
  if (!recentUserTexts.length) return "";
  return buildKnowledgeGraphConversationQuery([
    ...recentUserTexts.reverse(),
    session.topic || "",
  ]);
}

function areModelConfigsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function RagKgSourcesView({
  sources,
}: {
  sources?: ChatMessage["ragKgSources"];
}) {
  if (!sources?.length) return null;

  type RagKgSourceItem = NonNullable<ChatMessage["ragKgSources"]>[number];
  type DocumentSource = Extract<RagKgSourceItem, { kind: "document" }>;
  type GraphSource = Extract<RagKgSourceItem, { kind: "graph" }>;
  const documentSources = sources.filter(
    (source): source is DocumentSource => source.kind === "document",
  );
  const graphSources = sources.filter(
    (source): source is GraphSource => source.kind === "graph",
  );
  if (!documentSources.length && !graphSources.length) return null;

  return (
    <div className={styles["rag-kg-sources"]}>
      <div className={styles["rag-kg-sources-title"]}>检索来源</div>
      {documentSources.length > 0 && (
        <div className={styles["rag-kg-source-list"]}>
          {documentSources.map((source) =>
            source.sourceUrl ? (
              <a
                key={source.id}
                className={styles["rag-kg-source-item"]}
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer"
                title={source.title}
              >
                <span className={styles["rag-kg-source-id"]}>{source.id}</span>
                <span className={styles["rag-kg-source-title"]}>
                  {source.title}
                </span>
              </a>
            ) : (
              <div
                key={source.id}
                className={styles["rag-kg-source-item"]}
                title={source.title}
              >
                <span className={styles["rag-kg-source-id"]}>{source.id}</span>
                <span className={styles["rag-kg-source-title"]}>
                  {source.title}
                </span>
              </div>
            ),
          )}
        </div>
      )}
      {graphSources.length > 0 && (
        <details className={styles["rag-kg-graph-sources"]}>
          <summary>知识图谱依据 {graphSources.length}</summary>
          <div className={styles["rag-kg-graph-list"]}>
            {graphSources.map((source) => (
              <div key={source.id} className={styles["rag-kg-graph-item"]}>
                <span className={styles["rag-kg-source-id"]}>{source.id}</span>
                <span>{source.source}</span>
                <span className={styles["rag-kg-relation"]}>
                  {source.relation}
                </span>
                <span>{source.target}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ResearchSourcesView({
  sources,
}: {
  sources?: ChatMessage["researchSources"];
}) {
  if (!sources?.length) return null;

  function getModeLabel(mode: string) {
    if (mode === "academic") return "学术";
    if (mode === "standard") return "标准/规范";
    if (mode === "patent") return "专利";
    return "网页";
  }

  return (
    <div className={styles["rag-kg-sources"]}>
      <div className={styles["rag-kg-sources-title"]}>外部检索来源</div>
      <div className={styles["rag-kg-source-list"]}>
        {sources.map((source) => {
          const meta = [
            getModeLabel(source.mode),
            source.source || source.venue || "",
            source.year ? String(source.year) : "",
            typeof source.score === "number"
              ? `分数 ${Number(source.score.toFixed(3))}`
              : "",
          ].filter(Boolean);

          return (
            <a
              key={`${source.id}-${source.url}`}
              className={styles["rag-kg-source-item"]}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.title}
            >
              <span className={styles["rag-kg-source-id"]}>{source.id}</span>
              <span className={styles["rag-kg-source-title"]}>
                {source.title}
                {meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function SessionFileSourcesView({
  sources,
}: {
  sources?: ChatMessage["sessionFileSources"];
}) {
  if (!sources?.length) return null;

  return (
    <div className={styles["rag-kg-sources"]}>
      <div className={styles["rag-kg-sources-title"]}>会话文件来源</div>
      <div className={styles["rag-kg-source-list"]}>
        {sources.map((source) => (
          <span
            key={source.id}
            className={styles["rag-kg-source-item"]}
            title={source.title}
          >
            <span className={styles["rag-kg-source-id"]}>{source.id}</span>
            <span className={styles["rag-kg-source-title"]}>
              {source.title}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function UserFileSourcesView({
  sources,
}: {
  sources?: ChatMessage["userFileSources"];
}) {
  if (!sources?.length) return null;

  return (
    <div className={styles["rag-kg-sources"]}>
      <div className={styles["rag-kg-sources-title"]}>用户文件来源</div>
      <div className={styles["rag-kg-source-list"]}>
        {sources.map((source) => (
          <span
            key={source.id}
            className={styles["rag-kg-source-item"]}
            title={source.title}
          >
            <span className={styles["rag-kg-source-id"]}>{source.id}</span>
            <span className={styles["rag-kg-source-title"]}>
              {source.title}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StructuredDesignArtifactView({
  artifact,
}: {
  artifact?: ChatMessage["designArtifact"];
}) {
  if (!artifact) return null;

  const result = artifact.result || {};
  const candidateCount =
    typeof result.candidate_count === "number" ? result.candidate_count : 0;
  const fingerprint =
    typeof result.design_fingerprint === "string"
      ? result.design_fingerprint
      : "未提供";
  const isFEMReady = artifact.generation_mode === "fem_ready_cylindrical_shell";
  const filePrefix = isFEMReady ? "fem-ready-candidates" : "design-candidates";

  return (
    <div className={styles["chat-message-design-artifact"]}>
      <div className={styles["chat-message-design-artifact-info"]}>
        <strong>
          {isFEMReady ? "FEM-ready 结构化候选" : "结构化设计候选"}
        </strong>
        <span>
          {candidateCount} 组，指纹 {fingerprint.slice(0, 16)}
        </span>
      </div>
      <ChatAction
        text={isFEMReady ? "下载 FEM JSON" : "下载候选 JSON"}
        icon={<DownloadIcon />}
        onClick={() =>
          void downloadAs(
            JSON.stringify(artifact, null, 2),
            `${filePrefix}-${fingerprint.slice(0, 16)}.json`,
          )
        }
      />
    </div>
  );
}

const MCPAction = () => {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);
  const [mcpEnabled, setMcpEnabled] = useState(false);

  useEffect(() => {
    const checkMcpStatus = async () => {
      const enabled = await isMcpEnabled();
      setMcpEnabled(enabled);
      if (enabled) {
        const count = await getAvailableClientsCount();
        setCount(count);
      }
    };
    checkMcpStatus();
  }, []);

  if (!mcpEnabled) return null;

  return (
    <ChatAction
      onClick={() => navigate(Path.McpMarket)}
      text={`MCP${count ? ` (${count})` : ""}`}
      icon={<McpToolIcon />}
    />
  );
};

export function SessionConfigModel(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const maskStore = useMaskStore();
  const navigate = useNavigate();

  const syncCurrentSessionSettings = async (failureMessage: string) => {
    const current = chatStore.currentSession();
    if (!current.messages?.length) return;
    const userStore = useUserStore.getState();
    if (!userStore.isLoggedIn) return;
    const synced = await syncConversationToDB(current);
    if (!synced) showToast(failureMessage);
  };

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Context.Edit}
        onClose={() => props.onClose()}
        actions={[
          <IconButton
            key="reset"
            icon={<ResetIcon />}
            bordered
            text={Locale.Chat.Config.Reset}
            onClick={async () => {
              if (await showConfirm(Locale.Memory.ResetConfirm)) {
                chatStore.updateTargetSession(session, (session) => {
                  session.memoryPrompt = "";
                  session.lastUpdate = Date.now();
                });
                void syncCurrentSessionSettings("保存会话设置失败");
              }
            }}
          />,
          <IconButton
            key="copy"
            icon={<CopyIcon />}
            bordered
            text={Locale.Chat.Config.SaveAs}
            onClick={() => {
              navigate(Path.Masks);
              setTimeout(() => {
                const maskToSave = { ...session.mask };
                if (maskToSave.name === DEFAULT_TOPIC) {
                  maskToSave.name = "";
                }
                maskStore.create(maskToSave);
              }, 500);
            }}
          />,
        ]}
      >
        <MaskConfig
          mask={session.mask}
          updateMask={(updater) => {
            const mask = { ...session.mask };
            updater(mask);
            chatStore.updateTargetSession(session, (session) => {
              session.mask = mask;
              session.lastUpdate = Date.now();
            });
            void syncCurrentSessionSettings("保存会话设置失败");
          }}
          shouldSyncFromGlobal
          extraListItems={
            <>
              <ListItem
                title={Locale.KnowledgeGraph.Title}
                subTitle={Locale.KnowledgeGraph.EmptySubTitle}
              >
                <IconButton
                  icon={<GraphIcon />}
                  text={Locale.KnowledgeGraph.Name}
                  onClick={() => {
                    navigate(
                      buildKnowledgeGraphPath(getKnowledgeGraphQuery(session)),
                    );
                  }}
                />
              </ListItem>
              {session.mask.modelConfig.sendMemory ? (
                <ListItem
                  className="copyable"
                  title={`${Locale.Memory.Title} (${session.lastSummarizeIndex} of ${session.messages.length})`}
                  subTitle={session.memoryPrompt || Locale.Memory.EmptyContent}
                ></ListItem>
              ) : null}
            </>
          }
        ></MaskConfig>
      </Modal>
    </div>
  );
}

function PromptToast(props: {
  showToast?: boolean;
  showModal?: boolean;
  setShowModal: (_: boolean) => void;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const context = session.mask.context;

  return (
    <div className={styles["prompt-toast"]} key="prompt-toast">
      {props.showToast && context.length > 0 && (
        <div
          className={clsx(styles["prompt-toast-inner"], "clickable")}
          role="button"
          onClick={() => props.setShowModal(true)}
        >
          <BrainIcon />
          <span className={styles["prompt-toast-content"]}>
            {Locale.Context.Toast(context.length)}
          </span>
        </div>
      )}
      {props.showModal && (
        <SessionConfigModel onClose={() => props.setShowModal(false)} />
      )}
    </div>
  );
}

function useSubmitHandler() {
  const config = useAppConfig();
  const submitKey = config.submitKey;
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Safari 中文输入法回车事件处理
    if (e.keyCode == 229) return false;
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;
    return (
      (config.submitKey === SubmitKey.AltEnter && e.altKey) ||
      (config.submitKey === SubmitKey.CtrlEnter && e.ctrlKey) ||
      (config.submitKey === SubmitKey.ShiftEnter && e.shiftKey) ||
      (config.submitKey === SubmitKey.MetaEnter && e.metaKey) ||
      (config.submitKey === SubmitKey.Enter &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey)
    );
  };

  return {
    submitKey,
    shouldSubmit,
  };
}

export type RenderPrompt = Pick<Prompt, "title" | "content">;

export function PromptHints(props: {
  prompts: RenderPrompt[];
  onPromptSelect: (prompt: RenderPrompt) => void;
}) {
  const noPrompts = props.prompts.length === 0;
  const [selectIndex, setSelectIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectIndex(0);
  }, [props.prompts.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (noPrompts || e.metaKey || e.altKey || e.ctrlKey) {
        return;
      }
      // 上下箭头选择提示词
      const changeIndex = (delta: number) => {
        e.stopPropagation();
        e.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(props.prompts.length - 1, selectIndex + delta),
        );
        setSelectIndex(nextIndex);
        selectedRef.current?.scrollIntoView({
          block: "center",
        });
      };

      if (e.key === "ArrowUp") {
        changeIndex(1);
      } else if (e.key === "ArrowDown") {
        changeIndex(-1);
      } else if (e.key === "Enter") {
        const selectedPrompt = props.prompts.at(selectIndex);
        if (selectedPrompt) {
          props.onPromptSelect(selectedPrompt);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prompts.length, selectIndex]);

  if (noPrompts) return null;
  return (
    <div className={styles["prompt-hints"]}>
      {props.prompts.map((prompt, i) => (
        <div
          ref={i === selectIndex ? selectedRef : null}
          className={clsx(styles["prompt-hint"], {
            [styles["prompt-hint-selected"]]: i === selectIndex,
          })}
          key={prompt.title + i.toString()}
          onClick={() => props.onPromptSelect(prompt)}
          onMouseEnter={() => setSelectIndex(i)}
        >
          <div className={styles["hint-title"]}>{prompt.title}</div>
          <div className={styles["hint-content"]}>{prompt.content}</div>
        </div>
      ))}
    </div>
  );
}

function ClearContextDivider() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateTargetSession(
          session,
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

export function ChatAction(props: {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
  active?: boolean;
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  return (
    <div
      className={clsx(styles["chat-input-action"], "clickable", {
        [styles["chat-input-action-active"]]: props.active,
      })}
      onClick={() => {
        props.onClick();
        setTimeout(updateWidth, 1);
      }}
      onMouseEnter={updateWidth}
      onTouchStart={updateWidth}
      style={
        {
          "--icon-width": `${width.icon}px`,
          "--full-width": `${width.full}px`,
        } as React.CSSProperties
      }
    >
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
        {props.text}
      </div>
    </div>
  );
}

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
  messages: ChatMessage[],
) {
  // 自动滚动
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollDomToBottom = useCallback(() => {
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoScroll(true);
        dom.scrollTo(0, dom.scrollHeight);
      });
    }
  }, [scrollRef]);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && !detach) {
      scrollDomToBottom();
    }
  });

  // 消息数量变化时自动滚动
  const lastMessagesLength = useRef(messages.length);
  useEffect(() => {
    if (messages.length > lastMessagesLength.current && !detach) {
      scrollDomToBottom();
    }
    lastMessagesLength.current = messages.length;
  }, [messages.length, detach, scrollDomToBottom]);

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

type AttachmentStatus = "parsing" | "ready" | "error";
export interface AttachmentInfo {
  id: string;
  url: string;
  name: string;
  size: number;
  type: string;
  status: AttachmentStatus;
  progress: number;
  stage?: string;
  error?: string;
  file?: File;
  previewUrl?: string;
  extractedText?: string;
}

function createAttachmentId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

async function deleteAttachmentRemote(url?: string) {
  if (!url || !url.startsWith("/api/files/")) return;
  const token = useUserStore.getState().token;
  await fetch(url, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => {});
}

export function ChatActions(props: {
  uploadFile: () => void;
  graphQuery: string;
  showPromptModal: () => void;
  scrollToBottom: () => void;
  showPromptHints: () => void;
  hitBottom: boolean;
  uploading: boolean;
  setShowShortcutKeyModal: React.Dispatch<React.SetStateAction<boolean>>;
  setUserInput: (input: string) => void;
}) {
  const config = useAppConfig();
  const navigate = useNavigate();
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  // 切换主题
  const theme = config.theme;

  function nextTheme() {
    const themes = [Theme.Auto, Theme.Light, Theme.Dark];
    const themeIndex = themes.indexOf(theme);
    const nextIndex = (themeIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    config.update((config) => (config.theme = nextTheme));
  }

  // 停止所有响应
  const couldStop = ChatControllerPool.hasPending();
  const stopAll = () => ChatControllerPool.stopAll();

  // 切换模型
  const currentModel = session.mask.modelConfig.model;
  const currentProviderName =
    session.mask.modelConfig?.providerName || ServiceProvider.CSGPT;
  const allModels = useAllModels();
  const models = useMemo(() => {
    const filteredModels = allModels.filter((m) => m.available);
    const defaultModel = filteredModels.find((m) => m.isDefault);

    if (defaultModel) {
      const arr = [
        defaultModel,
        ...filteredModels.filter((m) => m !== defaultModel),
      ];
      return arr;
    } else {
      return filteredModels;
    }
  }, [allModels]);
  const currentModelName = useMemo(() => {
    // 先精确匹配 model + provider
    let model = models.find(
      (m) =>
        m.name == currentModel &&
        m?.provider?.providerName == currentProviderName,
    );
    // 若未匹配到（自定义模型 providerName 可能不一致），仅按模型名查找
    if (!model) {
      model = models.find((m) => m.name == currentModel);
    }
    return model?.displayName ?? currentModel;
  }, [models, currentModel, currentProviderName]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showUploadFile, setShowUploadFile] = useState(false);
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const modelSizes = getModelSizes(currentModel);
  const dalle3Qualities: DalleQuality[] = ["standard", "hd"];
  const dalle3Styles: DalleStyle[] = ["vivid", "natural"];
  const currentSize =
    session.mask.modelConfig?.size ?? ("1024x1024" as ModelSize);
  const currentQuality = session.mask.modelConfig?.quality ?? "standard";
  const currentStyle = session.mask.modelConfig?.style ?? "vivid";
  const webSearchEnabled = !!session.mask.modelConfig.enableWebSearch;
  const academicSearchEnabled = !!session.mask.modelConfig.enableAcademicSearch;

  const isMobileScreen = useMobileScreen();

  const syncExistingSessionSettings = useCallback(async () => {
    const current = chatStore.currentSession();
    if (!current.messages?.length) return;
    const userStore = useUserStore.getState();
    if (!userStore.isLoggedIn) return;
    const synced = await syncConversationToDB(current);
    if (!synced) showToast("保存会话设置失败");
  }, [chatStore]);

  useEffect(() => {
    // 所有模型均支持文件上传
    setShowUploadFile(true);

    // 当前模型不可用时
    // 切换到第一个可用模型
    const isUnavailableModel = !models.some(
      (m) =>
        m.name === currentModel &&
        m.provider?.providerName === currentProviderName,
    );
    if (isUnavailableModel && models.length > 0) {
      // 优先切换到默认模型，否则切换到第一个可用模型
      let nextModel = models.find((model) => model.isDefault) || models[0];
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.model = nextModel.name;
        session.mask.modelConfig.providerName = nextModel?.provider
          ?.providerName as ServiceProvider;
        session.mask.syncGlobalConfig = false;
        session.lastUpdate = Date.now();
      });
      void syncExistingSessionSettings();
      showToast(
        nextModel?.provider?.providerName == "ByteDance"
          ? nextModel.displayName
          : nextModel.name,
      );
    }
  }, [
    chatStore,
    currentModel,
    currentProviderName,
    models,
    session,
    syncExistingSessionSettings,
  ]);

  async function clearSessionMessages() {
    const nextSession = {
      ...session,
      messages: [],
      memoryPrompt: "",
      clearContextIndex: undefined,
      lastSummarizeIndex: 0,
      lastUpdate: Date.now(),
    };
    const userStore = useUserStore.getState();
    if (userStore.isLoggedIn) {
      const synced = await syncConversationToDB(nextSession);
      if (!synced) {
        showToast("清除聊天记录失败");
        return;
      }
    }
    chatStore.updateTargetSession(session, (session) => {
      session.messages = nextSession.messages;
      session.memoryPrompt = nextSession.memoryPrompt;
      session.clearContextIndex = nextSession.clearContextIndex;
      session.lastSummarizeIndex = nextSession.lastSummarizeIndex;
      session.lastUpdate = nextSession.lastUpdate;
    });
  }

  function toggleSessionTool(key: "enableWebSearch" | "enableAcademicSearch") {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.modelConfig[key] = !session.mask.modelConfig[key];
      session.mask.syncGlobalConfig = false;
      session.lastUpdate = Date.now();
    });
    void syncExistingSessionSettings();
  }

  return (
    <div className={styles["chat-input-actions"]}>
      <>
        {couldStop && (
          <ChatAction
            onClick={stopAll}
            text={Locale.Chat.InputActions.Stop}
            icon={<StopIcon />}
          />
        )}
        {!props.hitBottom && (
          <ChatAction
            onClick={props.scrollToBottom}
            text={Locale.Chat.InputActions.ToBottom}
            icon={<BottomIcon />}
          />
        )}
        {props.hitBottom && (
          <ChatAction
            onClick={props.showPromptModal}
            text={Locale.Chat.InputActions.Settings}
            icon={<SettingsIcon />}
          />
        )}

        {showUploadFile && (
          <ChatAction
            onClick={props.uploadFile}
            text={Locale.Chat.InputActions.UploadImage}
            icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
          />
        )}
        <ChatAction
          onClick={() => toggleSessionTool("enableWebSearch")}
          text={Locale.Chat.InputActions.WebSearch}
          icon={<SearchIcon />}
          active={webSearchEnabled}
        />
        <ChatAction
          onClick={() => toggleSessionTool("enableAcademicSearch")}
          text={Locale.Chat.InputActions.AcademicSearch}
          icon={<BrainIcon />}
          active={academicSearchEnabled}
        />
        <ChatAction
          onClick={nextTheme}
          text={Locale.Chat.InputActions.Theme[theme]}
          icon={
            <>
              {theme === Theme.Auto ? (
                <AutoIcon />
              ) : theme === Theme.Light ? (
                <LightIcon />
              ) : theme === Theme.Dark ? (
                <DarkIcon />
              ) : null}
            </>
          }
        />

        <ChatAction
          onClick={props.showPromptHints}
          text={Locale.Chat.InputActions.Prompt}
          icon={<PromptIcon />}
        />

        <ChatAction
          onClick={() => {
            navigate(Path.Masks);
          }}
          text={Locale.Chat.InputActions.Masks}
          icon={<MaskIcon />}
        />

        <ChatAction
          text={Locale.Chat.InputActions.Clear}
          icon={<BreakIcon />}
          onClick={clearSessionMessages}
        />

        <ChatAction
          onClick={() => setShowModelSelector(true)}
          text={currentModelName}
          icon={
            <Avatar model={currentModel} providerName={currentProviderName} />
          }
        />

        {showModelSelector && (
          <Selector
            defaultSelectedValue={`${currentModel}@${currentProviderName}`}
            items={models.map((m) => ({
              title: `${m.displayName}${
                m?.provider?.providerName
                  ? " (" + m?.provider?.providerName + ")"
                  : ""
              }`,
              value: `${m.name}@${m?.provider?.providerName}`,
            }))}
            onClose={() => setShowModelSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const [model, providerName] = getModelProvider(s[0]);
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.model = model as ModelType;
                session.mask.modelConfig.providerName =
                  providerName as ServiceProvider;
                session.mask.syncGlobalConfig = false;
                session.lastUpdate = Date.now();
              });
              void syncExistingSessionSettings();
              if (providerName == "ByteDance") {
                const selectedModel = models.find(
                  (m) =>
                    m.name == model &&
                    m?.provider?.providerName == providerName,
                );
                showToast(selectedModel?.displayName ?? "");
              } else {
                showToast(model);
              }
            }}
          />
        )}

        {supportsCustomSize(currentModel) && (
          <ChatAction
            onClick={() => setShowSizeSelector(true)}
            text={currentSize}
            icon={<SizeIcon />}
          />
        )}

        {showSizeSelector && (
          <Selector
            defaultSelectedValue={currentSize}
            items={modelSizes.map((m) => ({
              title: m,
              value: m,
            }))}
            onClose={() => setShowSizeSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const size = s[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.size = size;
                session.mask.syncGlobalConfig = false;
                session.lastUpdate = Date.now();
              });
              void syncExistingSessionSettings();
              showToast(size);
            }}
          />
        )}

        {isDalle3(currentModel) && (
          <ChatAction
            onClick={() => setShowQualitySelector(true)}
            text={currentQuality}
            icon={<QualityIcon />}
          />
        )}

        {showQualitySelector && (
          <Selector
            defaultSelectedValue={currentQuality}
            items={dalle3Qualities.map((m) => ({
              title: m,
              value: m,
            }))}
            onClose={() => setShowQualitySelector(false)}
            onSelection={(q) => {
              if (q.length === 0) return;
              const quality = q[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.quality = quality;
                session.mask.syncGlobalConfig = false;
                session.lastUpdate = Date.now();
              });
              void syncExistingSessionSettings();
              showToast(quality);
            }}
          />
        )}

        {isDalle3(currentModel) && (
          <ChatAction
            onClick={() => setShowStyleSelector(true)}
            text={currentStyle}
            icon={<StyleIcon />}
          />
        )}

        {showStyleSelector && (
          <Selector
            defaultSelectedValue={currentStyle}
            items={dalle3Styles.map((m) => ({
              title: m,
              value: m,
            }))}
            onClose={() => setShowStyleSelector(false)}
            onSelection={(s) => {
              if (s.length === 0) return;
              const style = s[0];
              chatStore.updateTargetSession(session, (session) => {
                session.mask.modelConfig.style = style;
                session.mask.syncGlobalConfig = false;
                session.lastUpdate = Date.now();
              });
              void syncExistingSessionSettings();
              showToast(style);
            }}
          />
        )}

        {!isMobileScreen && (
          <ChatAction
            onClick={() => props.setShowShortcutKeyModal(true)}
            text={Locale.Chat.ShortcutKey.Title}
            icon={<ShortcutkeyIcon />}
          />
        )}
        {!isMobileScreen && <MCPAction />}
        <ChatAction
          onClick={() => {
            navigate(
              buildKnowledgeGraphPath(
                getKnowledgeGraphQuery(session, props.graphQuery),
              ),
            );
          }}
          text={Locale.KnowledgeGraph.Name}
          icon={<GraphIcon />}
        />
      </>
      <div className={styles["chat-input-actions-end"]}></div>
    </div>
  );
}

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const [messages, setMessages] = useState(session.messages.slice());

  const syncEditedSession = async () => {
    const userStore = useUserStore.getState();
    if (!userStore.isLoggedIn) return true;
    const synced = await syncConversationToDB(chatStore.currentSession());
    if (!synced) showToast("保存消息编辑失败");
    return synced;
  };

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.EditMessage.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={() => {
              props.onClose();
            }}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={async () => {
              chatStore.updateTargetSession(session, (session) => {
                session.messages = messages;
                session.lastUpdate = Date.now();
              });
              await syncEditedSession();
              props.onClose();
            }}
          />,
        ]}
      >
        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              value={session.topic}
              onInput={(e) => {
                chatStore.updateTargetSession(session, (session) => {
                  session.topic = e.currentTarget.value;
                  session.lastUpdate = Date.now();
                });
              }}
            ></input>
          </ListItem>
        </List>
        <ContextPrompts
          context={messages}
          updateContext={(updater) => {
            const newMessages = messages.slice();
            updater(newMessages);
            setMessages(newMessages);
          }}
        />
      </Modal>
    </div>
  );
}

export function DeleteAttachmentButton(props: {
  deleteAttachment: () => void;
}) {
  return (
    <div
      className={styles["delete-attachment"]}
      onClick={props.deleteAttachment}
    >
      <DeleteIcon />
    </div>
  );
}

export function ShortcutKeyModal(props: { onClose: () => void }) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcuts = [
    {
      title: Locale.Chat.ShortcutKey.newChat,
      keys: isMac ? ["⌘", "Shift", "O"] : ["Ctrl", "Shift", "O"],
    },
    { title: Locale.Chat.ShortcutKey.focusInput, keys: ["Shift", "Esc"] },
    {
      title: Locale.Chat.ShortcutKey.copyLastCode,
      keys: isMac ? ["⌘", "Shift", ";"] : ["Ctrl", "Shift", ";"],
    },
    {
      title: Locale.Chat.ShortcutKey.copyLastMessage,
      keys: isMac ? ["⌘", "Shift", "C"] : ["Ctrl", "Shift", "C"],
    },
    {
      title: Locale.Chat.ShortcutKey.showShortcutKey,
      keys: isMac ? ["⌘", "/"] : ["Ctrl", "/"],
    },
    {
      title: Locale.Chat.ShortcutKey.clearContext,
      keys: isMac
        ? ["⌘", "Shift", "backspace"]
        : ["Ctrl", "Shift", "backspace"],
    },
  ];
  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.ShortcutKey.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              props.onClose();
            }}
          />,
        ]}
      >
        <div className={styles["shortcut-key-container"]}>
          <div className={styles["shortcut-key-grid"]}>
            {shortcuts.map((shortcut, index) => (
              <div key={index} className={styles["shortcut-key-item"]}>
                <div className={styles["shortcut-key-title"]}>
                  {shortcut.title}
                </div>
                <div className={styles["shortcut-key-keys"]}>
                  {shortcut.keys.map((key, i) => (
                    <div key={i} className={styles["shortcut-key"]}>
                      <span>{key}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function _Chat() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const allModels = useAllModels();
  const fontSize = config.fontSize;
  const fontFamily = config.fontFamily;

  const [showExport, setShowExport] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottom = scrollRef?.current
    ? Math.abs(
        scrollRef.current.scrollHeight -
          (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
      ) <= 1
    : false;
  const isAttachWithTop = (() => {
    const lastMessage = scrollRef.current?.lastElementChild as HTMLElement;
    // 滚动容器未就绪或无消息时返回 false
    if (!scrollRef?.current || !lastMessage) return false;
    const topDistance =
      lastMessage!.getBoundingClientRect().top -
      scrollRef.current.getBoundingClientRect().top;
    // 为用户问题留出一些空间
    return topDistance < 100;
  })();

  const isTyping = userInput !== "";
  const getModelDisplayName = useCallback(
    (model?: string) => {
      if (!model) return "";
      const currentProviderName = session.mask.modelConfig.providerName;
      const matchedModel =
        allModels.find(
          (m) =>
            m.name === model &&
            m.provider?.providerName === currentProviderName,
        ) || allModels.find((m) => m.name === model);

      return matchedModel?.displayName || model;
    },
    [allModels, session.mask.modelConfig.providerName],
  );

  // 用户正在输入时，自动滚动到底部
  // 用户未输入时，仅在底部视图状态下自动滚动到底部。
  const { setAutoScroll, scrollDomToBottom } = useScrollToBottom(
    scrollRef,
    (isScrolledToBottom || isAttachWithTop) && !isTyping,
    session.messages,
  );
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const attachmentsRef = useRef<AttachmentInfo[]>([]);
  const cancelledAttachmentIdsRef = useRef(new Set<string>());
  const attachmentProcessing = attachments.some(
    (att) => att.status === "parsing",
  );
  const attachmentHasError = attachments.some((att) => att.status === "error");

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const cancelledAttachmentIds = cancelledAttachmentIdsRef.current;
    return () => {
      attachmentsRef.current.forEach((att) => {
        cancelledAttachmentIds.add(att.id);
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        deleteAttachmentRemote(att.url);
      });
      attachmentsRef.current = [];
    };
  }, []);

  const updateAttachment = useCallback(
    (id: string, patch: Partial<AttachmentInfo>) => {
      setAttachments((current) => {
        const next = current.map((att) =>
          att.id === id ? { ...att, ...patch } : att,
        );
        attachmentsRef.current = next;
        return next;
      });
    },
    [],
  );

  const parseSelectedFile = useCallback(
    async (file: File) => {
      const id = createAttachmentId();
      let uploadedFileUrl = "";
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;
      const overSizeLimit = file.size > MAX_FILE_UPLOAD_SIZE;
      const initialAttachment: AttachmentInfo = {
        id,
        url: "",
        name: file.name || "upload.bin",
        size: file.size,
        type: file.type || "application/octet-stream",
        status: overSizeLimit ? "error" : "parsing",
        progress: overSizeLimit ? 100 : 0,
        stage: overSizeLimit ? "解析失败" : "读取文件",
        error: overSizeLimit ? "附件超过 50MB" : undefined,
        file,
        previewUrl,
      };

      setAttachments((current) => {
        const next = current.concat(initialAttachment);
        attachmentsRef.current = next;
        return next;
      });
      if (overSizeLimit) {
        showToast("附件超过 50MB");
        return;
      }

      try {
        updateAttachment(id, {
          status: "parsing",
          progress: 10,
          stage: "解析中",
        });

        const { extractTextFromFile } = await import(
          "../utils/file-text-extractor"
        );
        const extraction = await extractTextFromFile(file, file.name, {
          includeImages: false,
          ocrImages: true,
          onProgress(progress, stage) {
            if (cancelledAttachmentIdsRef.current.has(id)) return;
            updateAttachment(id, {
              progress: Math.min(85, 10 + Math.round(progress * 0.75)),
              stage,
            });
          },
        });
        if (cancelledAttachmentIdsRef.current.has(id)) return;

        updateAttachment(id, {
          status: "parsing",
          progress: 88,
          stage: "解析中",
        });
        const fileUrl = await uploadFileRemote(file, file.name, (progress) => {
          if (cancelledAttachmentIdsRef.current.has(id)) return;
          updateAttachment(id, {
            status: "parsing",
            progress: Math.min(99, 88 + Math.round(progress * 0.11)),
            stage: "解析中",
          });
        });
        uploadedFileUrl = fileUrl;
        if (cancelledAttachmentIdsRef.current.has(id)) {
          await deleteAttachmentRemote(fileUrl);
          return;
        }

        await saveExtractedText(fileUrl, extraction.text);
        if (cancelledAttachmentIdsRef.current.has(id)) {
          await deleteAttachmentRemote(fileUrl);
          return;
        }

        updateAttachment(id, {
          status: "ready",
          progress: 100,
          stage: "解析完成",
          url: fileUrl,
          file: undefined,
          extractedText: extraction.text,
        });
      } catch (error) {
        if (cancelledAttachmentIdsRef.current.has(id)) return;
        if (uploadedFileUrl) {
          await deleteAttachmentRemote(uploadedFileUrl);
        }
        updateAttachment(id, {
          status: "error",
          progress: 100,
          stage: "解析失败",
          error: error instanceof Error ? error.message : "解析失败",
        });
        showToast(error instanceof Error ? error.message : "解析失败");
      }
    },
    [updateAttachment],
  );

  // 提示词建议
  const promptStore = usePromptStore();
  const [promptHints, setPromptHints] = useState<RenderPrompt[]>([]);
  const onSearch = useDebouncedCallback(
    (text: string) => {
      const matchedPrompts = promptStore.search(text);
      setPromptHints(matchedPrompts);
    },
    100,
    { leading: true, trailing: true },
  );

  // 输入框自适应高度
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

  // 聊天命令快捷键
  const chatCommands = useChatCommand({
    new: () => chatStore.newSession(),
    newm: () => navigate(Path.NewChat),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: async () => {
      chatStore.updateTargetSession(session, (session) => {
        session.messages = [];
        session.memoryPrompt = "";
        session.clearContextIndex = undefined;
        session.lastSummarizeIndex = 0;
        session.lastUpdate = Date.now();
      });
      const userStore = useUserStore.getState();
      if (userStore.isLoggedIn) {
        const synced = await syncConversationToDB(chatStore.currentSession());
        if (!synced) showToast("清除聊天记录失败");
      }
    },
    fork: () => chatStore.forkSession(),
    del: () => chatStore.deleteSession(chatStore.currentSessionIndex),
  });

  // 仅在用户输入较短时搜索提示词
  const SEARCH_TEXT_LIMIT = 30;
  const onInput = (text: string) => {
    setUserInput(text);
    const n = text.trim().length;

    // 清空搜索结果
    if (n === 0) {
      setPromptHints([]);
    } else if (text.match(ChatCommandPrefix)) {
      setPromptHints(chatCommands.search(text));
    } else if (!config.disablePromptHint && n < SEARCH_TEXT_LIMIT) {
      // 检查是否需要触发自动补全
      if (text.startsWith("/")) {
        let searchText = text.slice(1);
        onSearch(searchText);
      }
    }
  };

  const doSubmit = (userInput: string) => {
    if (userInput.trim() === "" && isEmpty(attachments)) return;
    if (attachmentProcessing) {
      showToast("文件仍在解析中");
      return;
    }
    if (attachmentHasError) {
      showToast("请删除解析失败的附件后再发送");
      return;
    }
    const matchCommand = chatCommands.match(userInput);
    if (matchCommand.matched) {
      setUserInput("");
      setPromptHints([]);
      matchCommand.invoke();
      return;
    }
    const modelAttachments = attachments.map(
      ({ file, previewUrl, ...att }) => att,
    );
    chatStore.onUserInput(userInput, modelAttachments);
    attachments.forEach((att) => {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    });
    attachmentsRef.current = [];
    setAttachments([]);
    chatStore.setLastInput(userInput);
    setUserInput("");
    setPromptHints([]);
    if (!isMobileScreen) inputRef.current?.focus();
    setAutoScroll(true);
  };

  const onPromptSelect = (prompt: RenderPrompt) => {
    setTimeout(() => {
      setPromptHints([]);

      const matchedChatCommand = chatCommands.match(prompt.content);
      if (matchedChatCommand.matched) {
        // 用户选择的是聊天命令，直接触发
        matchedChatCommand.invoke();
        setUserInput("");
      } else {
        // 否则填充提示词内容
        setUserInput(prompt.content);
      }
      inputRef.current?.focus();
    }, 30);
  };

  const syncCurrentSessionState = async (
    failureMessage: string,
    sessionToSync?: ChatSession,
  ) => {
    const userStore = useUserStore.getState();
    if (!userStore.isLoggedIn) return true;
    const synced = await syncConversationToDB(
      sessionToSync ?? chatStore.currentSession(),
    );
    if (!synced) showToast(failureMessage);
    return synced;
  };

  // 停止响应
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  useEffect(() => {
    let syncedFromGlobal = false;
    chatStore.updateTargetSession(session, (session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        // 检查是否需要停止所有过期消息
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          if (m.content.length === 0) {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });

      // 自动把全局模型配置同步到当前会话配置。
      if (session.mask.syncGlobalConfig) {
        const nextModelConfig = { ...config.modelConfig };
        if (!areModelConfigsEqual(session.mask.modelConfig, nextModelConfig)) {
          session.mask.modelConfig = nextModelConfig;
          session.lastUpdate = Date.now();
          syncedFromGlobal = true;
        }
      }
    });
    if (syncedFromGlobal && session.messages.length > 0) {
      void syncCurrentSessionState("保存会话设置失败");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.modelConfig, session]);

  // 检查是否应该发送消息
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 按上箭头且无输入内容时，填充上次输入
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(chatStore.lastInput ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0) {
      doSubmit(userInput);
      e.preventDefault();
    }
  };
  const onRightClick = (e: any, message: ChatMessage) => {
    // 复制到剪贴板
    if (selectOrCopy(e.currentTarget, getMessageTextContent(message))) {
      if (userInput.length === 0) {
        setUserInput(getMessageTextContent(message));
      }

      e.preventDefault();
    }
  };

  const deleteMessage = async (msgId?: string, shouldSync = true) => {
    if (!msgId) return;
    const nextSession = {
      ...session,
      messages: session.messages.filter((m) => m.id !== msgId),
      lastUpdate: Date.now(),
    };
    if (shouldSync) {
      const synced = await syncCurrentSessionState("删除消息失败", nextSession);
      if (!synced) return;
    }
    chatStore.updateTargetSession(session, (session) => {
      session.messages = nextSession.messages;
      session.lastUpdate = nextSession.lastUpdate;
    });
  };

  const onDelete = (msgId: string) => {
    void deleteMessage(msgId);
  };

  const onResend = (message: ChatMessage) => {
    // 重新发送消息时
    // 1. 用户消息：找到下一条机器人回复
    // 2. 机器人消息：找到上一条用户输入
    // 3. 删除原始的用户输入和机器人回复
    // 4. 重新发送用户输入

    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // 重新发送机器人消息时，找到对应的用户输入
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          break;
        }
      }
    } else if (message.role === "user") {
      // 重新发送用户输入时，找到对应的机器人回复
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    // 删除原始消息
    void deleteMessage(userMessage.id, false);
    void deleteMessage(botMessage?.id, false);

    // 重新发送消息
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    const files = getMessageFiles(userMessage);
    const attachments: AttachmentInfo[] = [
      ...images.map((url) => ({
        id: createAttachmentId(),
        url,
        name: url.split("/").pop() || "image",
        size: 0,
        type: "image/png",
        status: "ready" as const,
        progress: 100,
      })),
      ...files.map((file) => ({
        id: createAttachmentId(),
        url: file.url,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "ready" as const,
        progress: 100,
      })),
    ];
    chatStore.onUserInput(
      textContent,
      attachments,
      false,
      userMessage.fileContent,
    );
    inputRef.current?.focus();
  };

  const onPinMessage = (message: ChatMessage) => {
    chatStore.updateTargetSession(session, (session) => {
      session.mask.context.push(message);
      session.lastUpdate = Date.now();
    });
    void syncCurrentSessionState("保存置顶消息失败");

    showToast(Locale.Chat.Actions.PinToastContent, {
      text: Locale.Chat.Actions.PinToastAction,
      onClick: () => {
        setShowPromptModal(true);
      },
    });
  };

  const accessStore = useAccessStore();

  const context: ChatMessage[] = useMemo(() => {
    return session.mask.hideContext ? [] : session.mask.context.slice();
  }, [session.mask.context, session.mask.hideContext]);

  if (
    context.length === 0 &&
    session.messages.at(0)?.content !== BOT_HELLO.content
  ) {
    const copiedHello = Object.assign({}, BOT_HELLO);
    if (!accessStore.isAuthorized()) {
      copiedHello.content = Locale.Error.Unauthorized;
    }
    context.push(copiedHello);
  }

  const renderMessages = useMemo(() => {
    return context.concat(session.messages);
  }, [context, session.messages]);

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );

  function setMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    _setMsgRenderIndex(newIndex);
  }

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);
  };

  function scrollToBottom() {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  // 清除上下文索引 = 上下文长度 + 消息索引
  const clearContextIndex =
    (session.clearContextIndex ?? -1) >= 0
      ? session.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const [showPromptModal, setShowPromptModal] = useState(false);

  const clientConfig = useMemo(() => getClientConfig(), []);

  const autoFocus = !isMobileScreen; // 移动端不自动聚焦
  const showMaxIcon = !isMobileScreen && !clientConfig?.isApp;

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      doSubmit(text);
    },
    code: (text) => {
      if (accessStore.disableFastLink) return;
      showConfirm(Locale.URLCommand.Code + `code = ${text}`).then((res) => {
        if (res) {
          accessStore.update((access) => (access.accessCode = text));
        }
      });
    },
    settings: (text) => {
      if (accessStore.disableFastLink) return;

      try {
        const payload = JSON.parse(text) as {
          key?: string;
          url?: string;
        };

        if (payload.key || payload.url) {
          showConfirm(
            Locale.URLCommand.Settings +
              `\n${JSON.stringify(payload, null, 4)}`,
          ).then((res) => {
            if (!res) return;
            if (payload.key) {
              accessStore.update(
                (access) => (access.openaiApiKey = payload.key!),
              );
            }
            if (payload.url) {
              accessStore.update((access) => (access.openaiUrl = payload.url!));
            }
            accessStore.update((access) => (access.useCustomConfig = true));
          });
        }
      } catch {
        console.error("[Command] failed to get settings from url: ", text);
      }
    },
  });

  // 编辑/插入消息弹窗
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  // 记住未完成的输入
  useEffect(() => {
    // 尝试从本地存储加载
    const key = UNFINISHED_INPUT(session.id);
    const mayBeUnfinishedInput = localStorage.getItem(key);
    if (mayBeUnfinishedInput && userInput.length === 0) {
      setUserInput(mayBeUnfinishedInput);
      localStorage.removeItem(key);
    }

    const dom = inputRef.current;
    return () => {
      localStorage.setItem(key, dom?.value ?? "");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = (event.clipboardData || window.clipboardData).items;
      for (const item of items) {
        if (item.kind === "file") {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            parseSelectedFile(file);
          }
        }
      }
    },
    [parseSelectedFile],
  );

  async function selectUploadFiles() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "*/*";
    fileInput.multiple = true;
    fileInput.onchange = (event: any) => {
      const files = event.target.files as FileList;
      for (let i = 0; i < files.length; i++) {
        parseSelectedFile(files[i]);
      }
    };
    fileInput.click();
  }

  // 拖放文件上传
  const handleDragDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = event.dataTransfer.files;
      if (files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        parseSelectedFile(files[i]);
      }
    },
    [parseSelectedFile],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    [],
  );

  // 快捷键 shortcut keys
  const [showShortcutKeyModal, setShowShortcutKeyModal] = useState(false);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      // 打开新聊天 command + shift + o
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        setTimeout(() => {
          chatStore.newSession();
          navigate(Path.Chat);
        }, 10);
      }
      // 聚焦聊天输入 shift + esc
      else if (event.shiftKey && event.key.toLowerCase() === "escape") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      // 复制最后一个代码块 command + shift + ;
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "Semicolon"
      ) {
        event.preventDefault();
        const copyCodeButton =
          document.querySelectorAll<HTMLElement>(".copy-code-button");
        if (copyCodeButton.length > 0) {
          copyCodeButton[copyCodeButton.length - 1].click();
        }
      }
      // 复制最后一个回复 command + shift + c
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        const lastNonUserMessage = messages
          .filter((message) => message.role !== "user")
          .pop();
        if (lastNonUserMessage) {
          const lastMessageContent = getMessageTextContent(lastNonUserMessage);
          copyToClipboard(lastMessageContent);
        }
      }
      // 展示快捷键 command + /
      else if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShowShortcutKeyModal(true);
      }
      // 清除上下文 command + shift + backspace
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "backspace"
      ) {
        event.preventDefault();
        chatStore.updateTargetSession(session, (session) => {
          if (session.clearContextIndex === session.messages.length) {
            session.clearContextIndex = undefined;
          } else {
            session.clearContextIndex = session.messages.length;
            session.memoryPrompt = ""; // 清空记忆
          }
          session.lastUpdate = Date.now();
        });
        const synced = await syncConversationToDB(chatStore.currentSession());
        if (!synced) showToast("清除上下文失败");
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [messages, chatStore, navigate, session]);

  return (
    <>
      <div className={styles.chat} key={session.id}>
        <div className="window-header" data-tauri-drag-region>
          {isMobileScreen && (
            <div className="window-actions">
              <div className={"window-action-button"}>
                <IconButton
                  icon={<ReturnIcon />}
                  bordered
                  title={Locale.Chat.Actions.ChatList}
                  onClick={() => navigate(Path.Home)}
                />
              </div>
            </div>
          )}

          <div
            className={clsx("window-header-title", styles["chat-body-title"])}
          >
            <div
              className={clsx(
                "window-header-main-title",
                styles["chat-body-main-title"],
              )}
              onClickCapture={() => setIsEditingMessage(true)}
            >
              {!session.topic ? DEFAULT_TOPIC : session.topic}
            </div>
            <div className="window-header-sub-title">
              {Locale.Chat.SubTitle(session.messages.length)}
            </div>
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<ReloadIcon />}
                bordered
                title={Locale.Chat.Actions.RefreshTitle}
                onClick={() => {
                  showToast(Locale.Chat.Actions.RefreshToast);
                  chatStore.summarizeSession(true, session);
                }}
              />
            </div>
            {!isMobileScreen && (
              <div className="window-action-button">
                <IconButton
                  icon={<RenameIcon />}
                  bordered
                  title={Locale.Chat.EditMessage.Title}
                  aria={Locale.Chat.EditMessage.Title}
                  onClick={() => setIsEditingMessage(true)}
                />
              </div>
            )}
            <div className="window-action-button">
              <IconButton
                icon={<ExportIcon />}
                bordered
                title={Locale.Chat.Actions.Export}
                onClick={() => {
                  setShowExport(true);
                }}
              />
            </div>
            {showMaxIcon && (
              <div className="window-action-button">
                <IconButton
                  icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                  bordered
                  title={Locale.Chat.Actions.FullScreen}
                  aria={Locale.Chat.Actions.FullScreen}
                  onClick={() => {
                    config.update(
                      (config) => (config.tightBorder = !config.tightBorder),
                    );
                  }}
                />
              </div>
            )}
          </div>

          <PromptToast
            showToast={!hitBottom}
            showModal={showPromptModal}
            setShowModal={setShowPromptModal}
          />
        </div>
        <div className={styles["chat-main"]}>
          <div className={styles["chat-body-container"]}>
            <div
              className={styles["chat-body"]}
              ref={scrollRef}
              onScroll={(e) => onChatBodyScroll(e.currentTarget)}
              onMouseDown={() => inputRef.current?.blur()}
              onTouchStart={() => {
                inputRef.current?.blur();
                setAutoScroll(false);
              }}
            >
              {messages.map((message, i) => {
                const isUser = message.role === "user";
                const isContext = i < context.length;
                const showActions =
                  i > 0 && message.content.length !== 0 && !isContext;
                const showTyping = message.streaming;

                const shouldShowClearContextDivider =
                  i === clearContextIndex - 1;

                return (
                  <Fragment key={message.id}>
                    <div
                      className={
                        isUser
                          ? styles["chat-message-user"]
                          : styles["chat-message"]
                      }
                    >
                      <div className={styles["chat-message-container"]}>
                        <div className={styles["chat-message-header"]}>
                          <div className={styles["chat-message-avatar"]}>
                            <div className={styles["chat-message-edit"]}>
                              <IconButton
                                icon={<EditIcon />}
                                aria={Locale.Chat.Actions.Edit}
                                onClick={async () => {
                                  const newMessage = await showPrompt(
                                    Locale.Chat.Actions.Edit,
                                    getMessageTextContent(message),
                                    10,
                                  );
                                  let newContent: string | MultimodalContent[] =
                                    newMessage;
                                  const images = getMessageImages(message);
                                  const files = getMessageFiles(message);
                                  if (images.length > 0 || files.length > 0) {
                                    newContent = [
                                      { type: "text", text: newMessage },
                                    ];
                                    for (let i = 0; i < images.length; i++) {
                                      newContent.push({
                                        type: "image_url",
                                        image_url: {
                                          url: images[i],
                                        },
                                      });
                                    }
                                    for (let i = 0; i < files.length; i++) {
                                      newContent.push({
                                        type: "file_url",
                                        file_url: {
                                          url: files[i].url,
                                          name: files[i].name,
                                          size: files[i].size,
                                          type: files[i].type,
                                        },
                                      });
                                    }
                                  }
                                  chatStore.updateTargetSession(
                                    session,
                                    (session) => {
                                      const m = session.mask.context
                                        .concat(session.messages)
                                        .find((m) => m.id === message.id);
                                      if (m) {
                                        m.content = newContent;
                                      }
                                      session.lastUpdate = Date.now();
                                    },
                                  );
                                  void syncCurrentSessionState(
                                    "保存消息编辑失败",
                                  );
                                }}
                              ></IconButton>
                            </div>
                            {isUser ? (
                              <Avatar avatar={config.avatar} />
                            ) : (
                              <>
                                {["system"].includes(message.role) ? (
                                  <Avatar avatar="2699-fe0f" />
                                ) : (
                                  <MaskAvatar
                                    avatar={session.mask.avatar}
                                    model={
                                      message.model ||
                                      session.mask.modelConfig.model
                                    }
                                    providerName={
                                      session.mask.modelConfig.providerName
                                    }
                                  />
                                )}
                              </>
                            )}
                          </div>
                          {!isUser && (
                            <div className={styles["chat-model-name"]}>
                              {getModelDisplayName(message.model)}
                            </div>
                          )}

                          {showActions && (
                            <div className={styles["chat-message-actions"]}>
                              <div className={styles["chat-input-actions"]}>
                                {message.streaming ? (
                                  <ChatAction
                                    text={Locale.Chat.Actions.Stop}
                                    icon={<StopIcon />}
                                    onClick={() => onUserStop(message.id ?? i)}
                                  />
                                ) : (
                                  <>
                                    <ChatAction
                                      text={Locale.Chat.Actions.Retry}
                                      icon={<ResetIcon />}
                                      onClick={() => onResend(message)}
                                    />

                                    <ChatAction
                                      text={Locale.Chat.Actions.Delete}
                                      icon={<DeleteIcon />}
                                      onClick={() => onDelete(message.id ?? i)}
                                    />

                                    <ChatAction
                                      text={Locale.Chat.Actions.Pin}
                                      icon={<PinIcon />}
                                      onClick={() => onPinMessage(message)}
                                    />
                                    <ChatAction
                                      text={Locale.Chat.Actions.Copy}
                                      icon={<CopyIcon />}
                                      onClick={() =>
                                        copyToClipboard(
                                          getMessageTextContent(message),
                                        )
                                      }
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {message?.tools?.length == 0 && showTyping && (
                          <div className={styles["chat-message-status"]}>
                            {Locale.Chat.Typing}
                          </div>
                        )}
                        {(message?.tools?.length ?? 0) > 0 && (
                          <div className={styles["chat-message-tools"]}>
                            {message?.tools?.map((tool) => (
                              <div
                                key={tool.id}
                                title={tool?.errorMsg || tool.content}
                                className={styles["chat-message-tool"]}
                              >
                                {tool.isError === false ? (
                                  <ConfirmIcon />
                                ) : tool.isError === true ? (
                                  <CloseIcon />
                                ) : (
                                  <LoadingButtonIcon />
                                )}
                                <span>{tool?.function?.name}</span>
                                {tool.content && (
                                  <span
                                    className={
                                      styles["chat-message-tool-content"]
                                    }
                                  >
                                    {tool.content}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className={styles["chat-message-item"]}>
                          <Markdown
                            key={message.streaming ? "loading" : "done"}
                            content={getMessageTextContent(message)}
                            loading={
                              message.streaming &&
                              message.content.length === 0 &&
                              !isUser
                            }
                            //   onContextMenu={(e) => onRightClick(e, message)} // hard to use
                            onDoubleClickCapture={() => {
                              if (!isMobileScreen) return;
                              setUserInput(getMessageTextContent(message));
                            }}
                            fontSize={fontSize}
                            fontFamily={fontFamily}
                            parentRef={scrollRef}
                            defaultShow={i >= messages.length - 6}
                          />
                          {getMessageImages(message).length == 1 && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={styles["chat-message-item-image"]}
                              src={getMessageImages(message)[0]}
                              alt=""
                            />
                          )}
                          {getMessageImages(message).length > 1 && (
                            <div
                              className={styles["chat-message-item-images"]}
                              style={
                                {
                                  "--image-count":
                                    getMessageImages(message).length,
                                } as React.CSSProperties
                              }
                            >
                              {getMessageImages(message).map((image, index) => {
                                return (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    className={
                                      styles["chat-message-item-image-multi"]
                                    }
                                    key={index}
                                    src={image}
                                    alt=""
                                  />
                                );
                              })}
                            </div>
                          )}
                          {getMessageFiles(message).length > 0 && (
                            <div className={styles["chat-message-item-files"]}>
                              {getMessageFiles(message).map((file, index) => {
                                const ext = file.name
                                  .split(".")
                                  .pop()
                                  ?.toUpperCase();
                                const sizeText =
                                  file.size < 1024
                                    ? `${file.size} B`
                                    : file.size < 1048576
                                    ? `${(file.size / 1024).toFixed(1)} KB`
                                    : `${(file.size / 1048576).toFixed(1)} MB`;
                                return (
                                  <div
                                    key={index}
                                    className={styles["chat-message-item-file"]}
                                    title={file.name}
                                    onClick={() =>
                                      window.open(file.url, "_blank")
                                    }
                                  >
                                    <div
                                      className={
                                        styles["chat-message-item-file-icon"]
                                      }
                                    >
                                      {ext || "FILE"}
                                    </div>
                                    <div
                                      className={
                                        styles["chat-message-item-file-info"]
                                      }
                                    >
                                      <div
                                        className={
                                          styles["chat-message-item-file-name"]
                                        }
                                      >
                                        {file.name}
                                      </div>
                                      <div
                                        className={
                                          styles["chat-message-item-file-size"]
                                        }
                                      >
                                        {sizeText}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {!isUser && (
                            <StructuredDesignArtifactView
                              artifact={message.designArtifact}
                            />
                          )}
                          {!isUser && (
                            <RagKgSourcesView sources={message.ragKgSources} />
                          )}
                          {!isUser && (
                            <ResearchSourcesView
                              sources={message.researchSources}
                            />
                          )}
                          {!isUser && (
                            <SessionFileSourcesView
                              sources={message.sessionFileSources}
                            />
                          )}
                          {!isUser && (
                            <UserFileSourcesView
                              sources={message.userFileSources}
                            />
                          )}
                        </div>
                        <div className={styles["chat-message-action-date"]}>
                          {isContext
                            ? Locale.Chat.IsContext
                            : message.date.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {shouldShowClearContextDivider && <ClearContextDivider />}
                  </Fragment>
                );
              })}
            </div>
            <div
              className={styles["chat-input-panel"]}
              onDragOver={handleDragOver}
              onDrop={handleDragDrop}
            >
              <PromptHints
                prompts={promptHints}
                onPromptSelect={onPromptSelect}
              />

              <ChatActions
                uploadFile={selectUploadFiles}
                graphQuery={userInput}
                showPromptModal={() => setShowPromptModal(true)}
                scrollToBottom={scrollToBottom}
                hitBottom={hitBottom}
                uploading={attachmentProcessing}
                showPromptHints={() => {
                  // 再次点击关闭
                  if (promptHints.length > 0) {
                    setPromptHints([]);
                    return;
                  }

                  inputRef.current?.focus();
                  setUserInput("/");
                  onSearch("");
                }}
                setShowShortcutKeyModal={setShowShortcutKeyModal}
                setUserInput={setUserInput}
              />
              <label
                className={clsx(styles["chat-input-panel-inner"], {
                  [styles["chat-input-panel-inner-attach"]]:
                    attachments.length !== 0,
                })}
                htmlFor="chat-input"
              >
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  className={styles["chat-input"]}
                  placeholder={Locale.Chat.Input(submitKey)}
                  onInput={(e) => onInput(e.currentTarget.value)}
                  value={userInput}
                  onKeyDown={onInputKeyDown}
                  onFocus={scrollToBottom}
                  onClick={scrollToBottom}
                  onPaste={handlePaste}
                  rows={inputRows}
                  autoFocus={autoFocus}
                  style={{
                    fontSize: config.fontSize,
                    fontFamily: config.fontFamily,
                  }}
                />
                {attachments.length != 0 && (
                  <div className={styles["attachments"]}>
                    {attachments.map((att, index) => {
                      const isImage = att.type.startsWith("image/");
                      return (
                        <div
                          key={att.id}
                          className={clsx(styles["attachment"], {
                            [styles["attachment-processing"]]:
                              att.status === "parsing",
                            [styles["attachment-error"]]:
                              att.status === "error",
                          })}
                          style={
                            isImage && (att.previewUrl || att.url)
                              ? {
                                  backgroundImage: `url("${
                                    att.previewUrl || att.url
                                  }")`,
                                }
                              : undefined
                          }
                        >
                          {!isImage && (
                            <div className={styles["attach-file-info"]}>
                              <span className={styles["attach-file-name"]}>
                                {att.name}
                              </span>
                            </div>
                          )}
                          {att.status !== "ready" && (
                            <div className={styles["attachment-progress"]}>
                              <span>{att.stage || "处理中"}</span>
                              <div
                                className={styles["attachment-progress-track"]}
                              >
                                <div
                                  className={
                                    styles["attachment-progress-value"]
                                  }
                                  style={{
                                    width: `${Math.max(
                                      0,
                                      Math.min(att.progress || 0, 100),
                                    )}%`,
                                  }}
                                />
                              </div>
                              {att.error && (
                                <span
                                  className={styles["attachment-error-text"]}
                                >
                                  {att.error}
                                </span>
                              )}
                            </div>
                          )}
                          <div className={styles["attachment-mask"]} />
                          <DeleteAttachmentButton
                            deleteAttachment={() => {
                              cancelledAttachmentIdsRef.current.add(att.id);
                              if (att.previewUrl) {
                                URL.revokeObjectURL(att.previewUrl);
                              }
                              deleteAttachmentRemote(att.url);
                              const nextAttachments = attachments.filter(
                                (_, i) => i !== index,
                              );
                              attachmentsRef.current = nextAttachments;
                              setAttachments(nextAttachments);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <IconButton
                  icon={<SendWhiteIcon />}
                  text={Locale.Chat.Send}
                  className={styles["chat-input-send"]}
                  type="primary"
                  disabled={attachmentProcessing || attachmentHasError}
                  onClick={() => doSubmit(userInput)}
                />
              </label>
            </div>
          </div>
          <div
            className={clsx(styles["chat-side-panel"], {
              [styles["mobile"]]: isMobileScreen,
            })}
          ></div>
        </div>
      </div>
      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {isEditingMessage && (
        <EditMessageModal
          onClose={() => {
            setIsEditingMessage(false);
          }}
        />
      )}

      {showShortcutKeyModal && (
        <ShortcutKeyModal onClose={() => setShowShortcutKeyModal(false)} />
      )}
    </>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  return <_Chat key={session.id}></_Chat>;
}
