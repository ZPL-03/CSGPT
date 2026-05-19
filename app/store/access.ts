import {
  ServiceProvider,
  StoreKey,
  ApiPath,
  OPENAI_BASE_URL,
  CSGPT_BASE_URL,
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
  BAIDU_BASE_URL,
  BYTEDANCE_BASE_URL,
  ALIBABA_BASE_URL,
  TENCENT_BASE_URL,
  MOONSHOT_BASE_URL,
  STABILITY_BASE_URL,
  IFLYTEK_BASE_URL,
  DEEPSEEK_BASE_URL,
  XAI_BASE_URL,
  CHATGLM_BASE_URL,
  SILICONFLOW_BASE_URL,
  AI302_BASE_URL,
} from "../constant";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { createPersistStore } from "../utils/store";
import { ensure } from "../utils/clone";
import { useAppConfig } from "./config";
import { getModelProvider } from "../utils/model";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done
const STORE_SCHEMA_VERSION = 1;

const isApp = getClientConfig()?.buildMode === "export";

// OpenAI 默认 API 路径：非 APP 模式走服务端代理 /api/openai
const DEFAULT_OPENAI_URL = isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;

const DEFAULT_GOOGLE_URL = isApp ? GEMINI_BASE_URL : ApiPath.Google;

const DEFAULT_ANTHROPIC_URL = isApp ? ANTHROPIC_BASE_URL : ApiPath.Anthropic;

const DEFAULT_BAIDU_URL = isApp ? BAIDU_BASE_URL : ApiPath.Baidu;

const DEFAULT_BYTEDANCE_URL = isApp ? BYTEDANCE_BASE_URL : ApiPath.ByteDance;

const DEFAULT_ALIBABA_URL = isApp ? ALIBABA_BASE_URL : ApiPath.Alibaba;

const DEFAULT_TENCENT_URL = isApp ? TENCENT_BASE_URL : ApiPath.Tencent;

const DEFAULT_MOONSHOT_URL = isApp ? MOONSHOT_BASE_URL : ApiPath.Moonshot;

const DEFAULT_STABILITY_URL = isApp ? STABILITY_BASE_URL : ApiPath.Stability;

const DEFAULT_IFLYTEK_URL = isApp ? IFLYTEK_BASE_URL : ApiPath.Iflytek;

const DEFAULT_DEEPSEEK_URL = isApp ? DEEPSEEK_BASE_URL : ApiPath.DeepSeek;

const DEFAULT_XAI_URL = isApp ? XAI_BASE_URL : ApiPath.XAI;

const DEFAULT_CHATGLM_URL = isApp ? CHATGLM_BASE_URL : ApiPath.ChatGLM;

const DEFAULT_SILICONFLOW_URL = isApp
  ? SILICONFLOW_BASE_URL
  : ApiPath.SiliconFlow;

const DEFAULT_AI302_URL = isApp ? AI302_BASE_URL : ApiPath["302.AI"];

// CSGPT 专用：默认 API 路径为 /api/csgpt
const DEFAULT_CSGPT_URL = isApp ? CSGPT_BASE_URL : ApiPath.CSGPT;

const DEFAULT_ACCESS_STATE = {
  accessCode: "",
  useCustomConfig: false,

  provider: ServiceProvider.CSGPT,

  // csgpt（内置 Qwen3-14B 微调模型）
  csgptUrl: DEFAULT_CSGPT_URL,
  csgptApiKey: "",

  // OpenAI
  openaiUrl: DEFAULT_OPENAI_URL,
  openaiApiKey: "",

  // Azure
  azureUrl: "",
  azureApiKey: "",
  azureApiVersion: "2023-08-01-preview",

  // Google AI Studio
  googleUrl: DEFAULT_GOOGLE_URL,
  googleApiKey: "",

  // Anthropic
  anthropicUrl: DEFAULT_ANTHROPIC_URL,
  anthropicApiKey: "",

  // 百度
  baiduUrl: DEFAULT_BAIDU_URL,
  baiduApiKey: "",
  baiduSecretKey: "",

  // 字节跳动
  bytedanceUrl: DEFAULT_BYTEDANCE_URL,
  bytedanceApiKey: "",

  // 阿里巴巴
  alibabaUrl: DEFAULT_ALIBABA_URL,
  alibabaApiKey: "",

  // 月之暗面
  moonshotUrl: DEFAULT_MOONSHOT_URL,
  moonshotApiKey: "",

  // Stability AI
  stabilityUrl: DEFAULT_STABILITY_URL,
  stabilityApiKey: "",

  // 腾讯
  tencentUrl: DEFAULT_TENCENT_URL,
  tencentSecretKey: "",
  tencentSecretId: "",

  // 科大讯飞
  iflytekUrl: DEFAULT_IFLYTEK_URL,
  iflytekApiKey: "",

  // DeepSeek
  deepseekUrl: DEFAULT_DEEPSEEK_URL,
  deepseekApiKey: "",

  // xAI
  xaiUrl: DEFAULT_XAI_URL,
  xaiApiKey: "",

  // 智谱 ChatGLM
  chatglmUrl: DEFAULT_CHATGLM_URL,
  chatglmApiKey: "",

  // 硅基流动
  siliconflowUrl: DEFAULT_SILICONFLOW_URL,
  siliconflowApiKey: "",

  // 302.AI
  ai302Url: DEFAULT_AI302_URL,
  ai302ApiKey: "",

  // 服务端配置
  needCode: true,
  hideUserApiKey: false,
  hideBalanceQuery: false,
  disableGPT4: false,
  disableFastLink: false,
  customModels: "",
  defaultModel: "",
};

type AccessState = typeof DEFAULT_ACCESS_STATE;

function normalizeAccessState(
  state?: Partial<AccessState> & { token?: string },
): AccessState {
  return {
    ...DEFAULT_ACCESS_STATE,
    ...(state || {}),
    openaiApiKey: state?.openaiApiKey || state?.token || "",
    azureApiVersion:
      state?.azureApiVersion || DEFAULT_ACCESS_STATE.azureApiVersion,
  };
}

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      this.fetch();

      return get().needCode;
    },
    isValidOpenAI() {
      return ensure(get(), ["openaiApiKey"]);
    },

    isValidAzure() {
      return ensure(get(), ["azureUrl", "azureApiKey", "azureApiVersion"]);
    },

    isValidGoogle() {
      return ensure(get(), ["googleApiKey"]);
    },

    isValidAnthropic() {
      return ensure(get(), ["anthropicApiKey"]);
    },

    isValidBaidu() {
      return ensure(get(), ["baiduApiKey", "baiduSecretKey"]);
    },

    isValidByteDance() {
      return ensure(get(), ["bytedanceApiKey"]);
    },

    isValidAlibaba() {
      return ensure(get(), ["alibabaApiKey"]);
    },

    isValidTencent() {
      return ensure(get(), ["tencentSecretKey", "tencentSecretId"]);
    },

    isValidMoonshot() {
      return ensure(get(), ["moonshotApiKey"]);
    },
    isValidIflytek() {
      return ensure(get(), ["iflytekApiKey"]);
    },
    isValidDeepSeek() {
      return ensure(get(), ["deepseekApiKey"]);
    },

    isValidXAI() {
      return ensure(get(), ["xaiApiKey"]);
    },

    isValidChatGLM() {
      return ensure(get(), ["chatglmApiKey"]);
    },

    isValidSiliconFlow() {
      return ensure(get(), ["siliconflowApiKey"]);
    },

    isValidCSGPT() {
      return ensure(get(), ["csgptApiKey"]);
    },

    isValidStability() {
      return ensure(get(), ["stabilityApiKey"]);
    },

    isValid302AI() {
      return ensure(get(), ["ai302ApiKey"]);
    },

    isAuthorized() {
      this.fetch();

      return (
        this.isValidCSGPT() ||
        this.isValidOpenAI() ||
        this.isValidAzure() ||
        this.isValidGoogle() ||
        this.isValidAnthropic() ||
        this.isValidBaidu() ||
        this.isValidByteDance() ||
        this.isValidAlibaba() ||
        this.isValidTencent() ||
        this.isValidStability() ||
        this.isValidMoonshot() ||
        this.isValidIflytek() ||
        this.isValidDeepSeek() ||
        this.isValidXAI() ||
        this.isValidChatGLM() ||
        this.isValidSiliconFlow() ||
        this.isValid302AI() ||
        !this.enabledAccessControl() ||
        (this.enabledAccessControl() && ensure(get(), ["accessCode"]))
      );
    },
    fetch() {
      if (fetchState > 0 || getClientConfig()?.buildMode === "export") return;
      fetchState = 1;
      fetch("/api/config", {
        method: "post",
        body: null,
        headers: {
          ...getHeaders(),
        },
      })
        .then((res) => res.json())
        .then((res) => {
          const defaultModel = res.defaultModel ?? "";
          if (defaultModel !== "") {
            const [model, providerName] = getModelProvider(defaultModel);
            // 全局默认模型写入 config store。
            useAppConfig.getState().update((config) => {
              config.modelConfig.model = model;
              if (providerName) {
                config.modelConfig.providerName =
                  providerName as ServiceProvider;
              }
            });
          }

          return res;
        })
        .then((res: DangerConfig) => {
          set(() => ({ ...res }));
        })
        .catch(() => {
          console.error("[Config] failed to fetch config");
        })
        .finally(() => {
          fetchState = 2;
        });
    },
  }),
  {
    name: StoreKey.Access,
    version: STORE_SCHEMA_VERSION,
    migrate(persistedState) {
      return normalizeAccessState(persistedState as any) as any;
    },
    // 服务端配置字段不在 localStorage 中持久化
    merge(persistedState, currentState) {
      const state = persistedState as any;
      if (!state) return { ...currentState };
      return {
        ...currentState,
        ...normalizeAccessState({
          ...currentState,
          ...state,
          // 服务端控制的配置字段始终以 currentState（服务端配置）为准
          customModels: currentState.customModels,
          defaultModel: currentState.defaultModel,
          needCode: currentState.needCode,
          hideUserApiKey: currentState.hideUserApiKey,
          hideBalanceQuery: currentState.hideBalanceQuery,
          disableGPT4: currentState.disableGPT4,
          disableFastLink: currentState.disableFastLink,
        }),
      };
    },
  },
);
