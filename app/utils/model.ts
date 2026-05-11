import {
  CSGPT_DEFAULT_MODEL,
  DEFAULT_MODELS,
  isLegacyCSGPTModelName,
  ServiceProvider,
} from "../constant";
import { LLMModel } from "../client/api";

const CustomSeq = {
  val: -1000, // 确保自定义模型排在前面，从 -1000 开始
  cache: new Map<string, number>(),
  next: (id: string) => {
    if (CustomSeq.cache.has(id)) {
      return CustomSeq.cache.get(id) as number;
    } else {
      let seq = CustomSeq.val++;
      CustomSeq.cache.set(id, seq);
      return seq;
    }
  },
};

const customProvider = (providerName: string) => ({
  id: providerName.toLowerCase(),
  providerName: providerName,
  providerType: "custom",
  sorted: CustomSeq.next(providerName),
});

const normalizeProviderName = (providerName?: string) =>
  providerName?.trim().toLowerCase();

function isSameProvider(
  provider: LLMModel["provider"] | undefined,
  providerName?: string,
) {
  const normalized = normalizeProviderName(providerName);
  if (!normalized) return true;

  return (
    normalizeProviderName(provider?.id) === normalized ||
    normalizeProviderName(provider?.providerName) === normalized
  );
}

/**
 * Sorts an array of models based on specified rules.
 *
 * First, sorted by provider; if the same, sorted by model
 */
const sortModelTable = (models: ReturnType<typeof collectModels>) =>
  models.sort((a, b) => {
    if (a.provider && b.provider) {
      let cmp = a.provider.sorted - b.provider.sorted;
      return cmp === 0 ? a.sorted - b.sorted : cmp;
    } else {
      return a.sorted - b.sorted;
    }
  });

/**
 * get model name and provider from a formatted string,
 * e.g. `gpt-4@OpenAi` or `claude-3-5-sonnet@20240620@Google`
 * @param modelWithProvider model name with provider separated by last `@` char,
 * @returns [model, provider] tuple, if no `@` char found, provider is undefined
 */
export function getModelProvider(modelWithProvider: string): [string, string?] {
  const [model, provider] = modelWithProvider.split(/@(?!.*@)/);
  return [model, provider];
}

export function collectModelTable(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable: Record<
    string,
    {
      available: boolean;
      name: string;
      displayName: string;
      sorted: number;
      provider?: LLMModel["provider"]; // 标记为可选
      isDefault?: boolean;
    }
  > = {};

  // 默认模型列表
  models.forEach((m) => {
    // 使用 <modelName>@<providerId> 格式作为 fullName
    modelTable[`${m.name}@${m?.provider?.id}`] = {
      ...m,
      displayName: m.displayName || m.name, // 'provider' is copied over if it exists
    };
  });

  // 服务端自定义模型
  customModels
    .split(",")
    .filter((v) => !!v && v.length > 0)
    .forEach((m) => {
      const available = !m.startsWith("-");
      const nameConfig =
        m.startsWith("+") || m.startsWith("-") ? m.slice(1) : m;
      let [name, displayName] = nameConfig.split("=");

      // 启用或禁用所有模型
      if (name === "all") {
        Object.values(modelTable).forEach(
          (model) => (model.available = available),
        );
      } else {
        // 1. find model by name, and set available value
        const [customModelName, customProviderName] = getModelProvider(name);
        let count = 0;
        for (const fullName in modelTable) {
          const modelInfo = modelTable[fullName];
          const modelName = modelInfo.name;
          if (
            customModelName == modelName &&
            isSameProvider(modelInfo.provider, customProviderName)
          ) {
            count += 1;
            modelTable[fullName]["available"] = available;
            // 字节跳动模型交换 name 和 displayName
            if (modelInfo.provider?.id === "bytedance") {
              [name, displayName] = [displayName, modelName];
              modelTable[fullName]["name"] = name;
            }
            if (displayName) {
              modelTable[fullName]["displayName"] = displayName;
            }
          }
        }
        // 2. if model not exists, create new model with available value
        if (count === 0) {
          let [customModelName, customProviderName] = getModelProvider(name);
          const provider = customProvider(
            customProviderName || customModelName,
          );
          // 字节跳动模型交换名称和显示名
          if (displayName && provider.providerName == "ByteDance") {
            [customModelName, displayName] = [displayName, customModelName];
          }
          modelTable[`${customModelName}@${provider?.id}`] = {
            name: customModelName,
            displayName: displayName || customModelName,
            available,
            provider, // 使用可选链
            sorted: CustomSeq.next(`${customModelName}@${provider?.id}`),
          };
        }
      }
    });

  return modelTable;
}

export function collectModelTableWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  let modelTable = collectModelTable(models, customModels);
  if (defaultModel && defaultModel !== "") {
    const [defaultModelName, defaultProviderName] =
      getModelProvider(defaultModel);
    for (const key of Object.keys(modelTable)) {
      const modelInfo = modelTable[key];
      if (
        modelInfo.available &&
        modelInfo.name === defaultModelName &&
        isSameProvider(modelInfo.provider, defaultProviderName)
      ) {
        modelInfo.isDefault = true;
        break;
      }
    }
  }
  return modelTable;
}

/**
 * Generate full model table.
 */
export function collectModels(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable = collectModelTable(models, customModels);
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}

export function collectModelsWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  const modelTable = collectModelTableWithDefaultModel(
    models,
    customModels,
    defaultModel,
  );
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}

export function isModelAvailableInServer(
  customModels: string,
  modelName: string,
  providerName: string,
) {
  const modelTable = collectModelTable(DEFAULT_MODELS, customModels);
  return Object.values(modelTable).some(
    (model) =>
      model.name === modelName &&
      isSameProvider(model.provider, providerName) &&
      model.available !== false,
  );
}

/**
 * Check if the model name is a GPT-4 related model
 *
 * @param modelName The name of the model to check
 * @returns True if the model is a GPT-4 related model (excluding gpt-4o-mini)
 */
export function isGPT4Model(modelName: string): boolean {
  return (
    (modelName.startsWith("gpt-4") ||
      modelName.startsWith("chatgpt-4o") ||
      modelName.startsWith("o1")) &&
    !modelName.startsWith("gpt-4o-mini")
  );
}

// 将历史模型名映射到 CSGPT 默认模型
export function normalizeCSGPTModelConfig(modelConfig: {
  model?: string;
  providerName?: string;
}) {
  if (
    (!modelConfig.providerName ||
      modelConfig.providerName === ServiceProvider.CSGPT) &&
    isLegacyCSGPTModelName(modelConfig.model)
  ) {
    modelConfig.model = CSGPT_DEFAULT_MODEL;
    modelConfig.providerName = ServiceProvider.CSGPT;
  }
}

/**
 * Checks if a model is not available on any of the specified providers in the server.
 *
 * @param {string} customModels - A string of custom models, comma-separated.
 * @param {string} modelName - The name of the model to check.
 * @param {string|string[]} providerNames - A string or array of provider names to check against.
 *
 * @returns {boolean} True if the model is not available on any of the specified providers, false otherwise.
 */
export function isModelNotAvailableInServer(
  customModels: string,
  modelName: string,
  providerNames: string | string[],
): boolean {
  // 检查 DISABLE_GPT4 环境变量
  if (
    process.env.DISABLE_GPT4 === "1" &&
    isGPT4Model(modelName.toLowerCase())
  ) {
    return true;
  }

  const modelTable = collectModelTable(DEFAULT_MODELS, customModels);

  const providerNamesArray = Array.isArray(providerNames)
    ? providerNames
    : [providerNames];
  for (const providerName of providerNamesArray) {
    // 字节跳动 provider 使用模型配置名称检查可用性
    if (providerName === ServiceProvider.ByteDance) {
      return !Object.values(modelTable).filter((v) => v.name === modelName)?.[0]
        ?.available;
    }
    if (
      Object.values(modelTable).some(
        (model) =>
          model.name === modelName &&
          isSameProvider(model.provider, providerName) &&
          model.available === true,
      )
    ) {
      return false;
    }
  }
  return true;
}
