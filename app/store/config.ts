import { LLMModel } from "../client/api";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { getClientConfig } from "../config/client";
import {
  DEFAULT_INPUT_TEMPLATE,
  CSGPT_DEFAULT_MODEL,
  CSGPT_DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS,
  DEFAULT_SIDEBAR_WIDTH,
  StoreKey,
  ServiceProvider,
} from "../constant";
import { createPersistStore } from "../utils/store";

export type ModelType = (typeof DEFAULT_MODELS)[number]["name"];

export enum SubmitKey {
  Enter = "Enter",
  CtrlEnter = "Ctrl + Enter",
  ShiftEnter = "Shift + Enter",
  AltEnter = "Alt + Enter",
  MetaEnter = "Meta + Enter",
}

export enum Theme {
  Auto = "auto",
  Dark = "dark",
  Light = "light",
}

const config = getClientConfig();
const STORE_SCHEMA_VERSION = 3;

export const DEFAULT_CONFIG = {
  lastUpdate: Date.now(), // 状态合并时间戳

  submitKey: SubmitKey.Enter,
  avatar: "1f603",
  fontSize: 14,
  fontFamily: "",
  theme: Theme.Auto as Theme,
  tightBorder: !!config?.isApp,
  enableAutoGenerateTitle: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,

  enableCodeFold: true, // 代码折叠配置

  disablePromptHint: false,

  dontShowMaskSplashScreen: false, // 新建聊天时不显示面具启动屏
  hideBuiltinMasks: false, // 不添加内置面具

  customModels: "",
  models: DEFAULT_MODELS as any as LLMModel[],

  modelConfig: {
    model: CSGPT_DEFAULT_MODEL as ModelType,
    providerName: ServiceProvider.CSGPT,
    temperature: 0.5,
    top_p: 1,
    max_tokens: CSGPT_DEFAULT_MAX_TOKENS,
    presence_penalty: 0,
    frequency_penalty: 0,
    enableRagKg: true,
    enableWebSearch: false,
    enableAcademicSearch: false,
    enableSessionFileRag: false,
    enableUserFileRag: false,
    sendMemory: true,
    historyMessageCount: 4,
    compressMessageLengthThreshold: 1000,
    compressModel: "",
    compressProviderName: "",
    enableInjectSystemPrompts: true,
    template: config?.template ?? DEFAULT_INPUT_TEMPLATE,
    size: "1024x1024" as ModelSize,
    quality: "standard" as DalleQuality,
    style: "vivid" as DalleStyle,
  },
};

export type ChatConfig = typeof DEFAULT_CONFIG;

export type ModelConfig = ChatConfig["modelConfig"];

const MODEL_CONFIG_KEYS = Object.keys(
  DEFAULT_CONFIG.modelConfig,
) as (keyof ModelConfig)[];

export function normalizeModelConfigState(
  input?: Partial<ModelConfig> | Record<string, unknown>,
): ModelConfig {
  const modelConfig = { ...DEFAULT_CONFIG.modelConfig } as ModelConfig;
  const source = input || {};

  MODEL_CONFIG_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      (modelConfig as any)[key] = (source as any)[key];
    }
  });

  if (!modelConfig.template) {
    modelConfig.template = config?.template ?? DEFAULT_INPUT_TEMPLATE;
  }

  if (typeof modelConfig.max_tokens !== "number") {
    modelConfig.max_tokens = DEFAULT_CONFIG.modelConfig.max_tokens;
  }

  return modelConfig;
}

function normalizeConfigState(
  state?: Partial<ChatConfig>,
  options?: { enforceDefaultRagKg?: boolean },
): ChatConfig {
  const stateModels = state?.models;
  const modelConfig = normalizeModelConfigState(state?.modelConfig);
  if (options?.enforceDefaultRagKg) {
    modelConfig.enableRagKg = DEFAULT_CONFIG.modelConfig.enableRagKg;
  }

  return {
    ...DEFAULT_CONFIG,
    ...(state || {}),
    lastUpdate:
      typeof state?.lastUpdate === "number" ? state.lastUpdate : Date.now(),
    customModels: state?.customModels ?? DEFAULT_CONFIG.customModels,
    models: Array.isArray(stateModels) ? stateModels : DEFAULT_CONFIG.models,
    modelConfig,
  } as ChatConfig;
}

export function limitNumber(
  x: number,
  min: number,
  max: number,
  defaultValue: number,
) {
  if (isNaN(x)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, x));
}

export const ModalConfigValidator = {
  model(x: string) {
    return x as ModelType;
  },
  max_tokens(x: number) {
    return limitNumber(x, 1, 512000, DEFAULT_CONFIG.modelConfig.max_tokens);
  },
  presence_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  frequency_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  temperature(x: number) {
    return limitNumber(x, 0, 2, 1);
  },
  top_p(x: number) {
    return limitNumber(x, 0, 1, 1);
  },
};

export const useAppConfig = createPersistStore(
  { ...DEFAULT_CONFIG },
  (set, get) => ({
    reset() {
      set(() => ({ ...DEFAULT_CONFIG }));
    },

    mergeModels(newModels: LLMModel[]) {
      if (!newModels || newModels.length === 0) {
        return;
      }

      const oldModels = get().models;
      const modelMap: Record<string, LLMModel> = {};

      for (const model of oldModels) {
        model.available = false;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      for (const model of newModels) {
        model.available = true;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      set(() => ({
        models: Object.values(modelMap),
      }));
    },
  }),
  {
    name: StoreKey.Config,
    version: STORE_SCHEMA_VERSION,

    merge(persistedState, currentState) {
      const state = persistedState as Partial<ChatConfig> | undefined;
      if (!state) {
        return {
          ...currentState,
          ...normalizeConfigState(currentState),
        };
      }
      const models = currentState.models.slice();
      const persistedModels = Array.isArray(state.models) ? state.models : [];
      persistedModels.forEach((pModel) => {
        const idx = models.findIndex(
          (v) =>
            v.name === pModel.name && v.provider?.id === pModel.provider?.id,
        );
        if (idx !== -1) models[idx] = pModel;
      });
      return {
        ...currentState,
        ...normalizeConfigState({
          ...currentState,
          ...state,
          models: models,
          customModels: currentState.customModels,
        }),
      };
    },

    migrate(persistedState, version) {
      const normalized = normalizeConfigState(
        persistedState as Partial<ChatConfig>,
        {
          enforceDefaultRagKg: (version ?? 0) < 2,
        },
      );
      if (
        (version ?? 0) < 3 &&
        normalized.modelConfig.providerName === ServiceProvider.CSGPT &&
        normalized.modelConfig.max_tokens === 8192
      ) {
        normalized.modelConfig.max_tokens =
          DEFAULT_CONFIG.modelConfig.max_tokens;
      }
      return normalized as any;
    },
  },
);
