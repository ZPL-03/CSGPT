import {
  CSGPT_DEFAULT_MODEL,
  CSGPT_DEFAULT_MODEL_DISPLAY_NAME,
  DEFAULT_GA_ID,
  DEFAULT_MODELS,
  ServiceProvider,
} from "../constant";
import { isGPT4Model } from "../utils/model";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      OPENAI_API_KEY?: string;
      CODE?: string;

      BASE_URL?: string;

      VERCEL?: string;
      BUILD_MODE?: "standalone" | "export";
      BUILD_APP?: string; // is building desktop app

      HIDE_USER_API_KEY?: string; // disable user's api key input
      DISABLE_GPT4?: string; // allow user to use gpt-4 or not
      ENABLE_BALANCE_QUERY?: string; // allow user to query balance or not
      DISABLE_FAST_LINK?: string; // disallow parse settings from url or not
      CUSTOM_MODELS?: string; // to control custom models
      DEFAULT_MODEL?: string; // to control default model in every new chat window
      // stability only
      STABILITY_URL?: string;
      STABILITY_API_KEY?: string;

      // azure only
      AZURE_URL?: string; // https://{azure-url}/openai/deployments/{deploy-name}
      AZURE_API_KEY?: string;
      AZURE_API_VERSION?: string;

      // google only
      GOOGLE_API_KEY?: string;
      GOOGLE_URL?: string;

      // google tag manager
      GTM_ID?: string;

      // anthropic only
      ANTHROPIC_URL?: string;
      ANTHROPIC_API_KEY?: string;

      // baidu only
      BAIDU_URL?: string;
      BAIDU_API_KEY?: string;
      BAIDU_SECRET_KEY?: string;

      // bytedance only
      BYTEDANCE_URL?: string;
      BYTEDANCE_API_KEY?: string;

      // alibaba only
      ALIBABA_URL?: string;
      ALIBABA_API_KEY?: string;

      // tencent only
      TENCENT_URL?: string;
      TENCENT_SECRET_KEY?: string;
      TENCENT_SECRET_ID?: string;

      // moonshot only
      MOONSHOT_URL?: string;
      MOONSHOT_API_KEY?: string;

      // iflytek only
      IFLYTEK_URL?: string;
      IFLYTEK_API_KEY?: string;

      DEEPSEEK_URL?: string;
      DEEPSEEK_API_KEY?: string;

      // xai only
      XAI_URL?: string;
      XAI_API_KEY?: string;

      // chatglm only
      CHATGLM_URL?: string;
      CHATGLM_API_KEY?: string;

      // siliconflow only
      SILICONFLOW_URL?: string;
      SILICONFLOW_API_KEY?: string;

      // 302.AI only
      AI302_URL?: string;
      AI302_API_KEY?: string;

      // custom template for preprocessing user input
      DEFAULT_INPUT_TEMPLATE?: string;

      ENABLE_MCP?: string; // enable mcp functionality

      // CSGPT 专用配置
      CSGPT_CS1_BASE_URL?: string; // CS1 上游服务地址
      CSGPT_CS1_API_KEY?: string; // CS1 上游 API 密钥
      CSGPT_CS1_UPSTREAM_MODEL_NAME?: string; // CS1 上游实际模型名称
      CSGPT_MODEL_NAME?: string; // 前端展示的 CSGPT 默认模型名称
      CSGPT_CS2_BASE_URL?: string; // CS2 上游服务地址
      CSGPT_CS2_API_KEY?: string; // CS2 上游 API 密钥
      CSGPT_CS2_UPSTREAM_MODEL_NAME?: string; // CS2 上游实际模型名称
      CSGPT_CS3_BASE_URL?: string; // CS3 上游服务地址
      CSGPT_CS3_API_KEY?: string; // CS3 上游 API 密钥
      CSGPT_CS3_UPSTREAM_MODEL_NAME?: string; // CS3 上游实际模型名称
    }
  }
}

// 数据库和认证配置
const DATABASE_URL = process.env.DATABASE_URL || "";
const JWT_SECRET = process.env.JWT_SECRET || "csgpt-jwt-secret";

function getApiKey(keys?: string) {
  const apiKeyEnvVar = keys ?? "";
  const apiKeys = apiKeyEnvVar.split(",").map((v) => v.trim());
  const randomIndex = Math.floor(Math.random() * apiKeys.length);
  const apiKey = apiKeys[randomIndex];
  if (apiKey) {
    console.log(
      `[Server Config] using ${randomIndex + 1} of ${apiKeys.length} api key`,
    );
  }

  return apiKey;
}

function appendCustomModel(
  customModels: string,
  modelKey: string,
  modelEntry = modelKey,
) {
  if (
    customModels
      .split(",")
      .map((v) => v.trim().replace(/^[+-]/, "").split("=")[0])
      .some((v) => v.toLowerCase() === modelKey.toLowerCase())
  ) {
    return customModels;
  }

  return [customModels, `+${modelEntry}`].filter(Boolean).join(",");
}

export const getServerSideConfig = () => {
  if (typeof process === "undefined") {
    throw Error(
      "[Server Config] you are importing a nodejs-only module outside of nodejs",
    );
  }

  const disableGPT4 = !!process.env.DISABLE_GPT4;
  const csgptModelName = process.env.CSGPT_MODEL_NAME || CSGPT_DEFAULT_MODEL;
  const csgptModelEntry = `${csgptModelName}@${ServiceProvider.CSGPT}`;
  let customModels = process.env.CUSTOM_MODELS ?? "";
  let defaultModel = process.env.DEFAULT_MODEL ?? csgptModelEntry;
  customModels = appendCustomModel(
    customModels,
    csgptModelEntry,
    csgptModelName === CSGPT_DEFAULT_MODEL
      ? `${csgptModelEntry}=${CSGPT_DEFAULT_MODEL_DISPLAY_NAME}`
      : csgptModelEntry,
  );

  if (disableGPT4) {
    if (customModels) customModels += ",";
    customModels += DEFAULT_MODELS.filter((m) => isGPT4Model(m.name))
      .map((m) => "-" + m.name)
      .join(",");
    if (defaultModel && isGPT4Model(defaultModel)) {
      defaultModel = "";
    }
  }

  const isStability = !!process.env.STABILITY_API_KEY;

  const isAzure = !!process.env.AZURE_URL;
  const isGoogle = !!process.env.GOOGLE_API_KEY;
  const isAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const isTencent =
    !!process.env.TENCENT_SECRET_KEY && !!process.env.TENCENT_SECRET_ID;

  const isBaidu = !!process.env.BAIDU_API_KEY;
  const isBytedance = !!process.env.BYTEDANCE_API_KEY;
  const isAlibaba = !!process.env.ALIBABA_API_KEY;
  const isMoonshot = !!process.env.MOONSHOT_API_KEY;
  const isIflytek = !!process.env.IFLYTEK_API_KEY;
  const isDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const isXAI = !!process.env.XAI_API_KEY;
  const isChatGLM = !!process.env.CHATGLM_API_KEY;
  const isSiliconFlow = !!process.env.SILICONFLOW_API_KEY;
  const isAI302 = !!process.env.AI302_API_KEY;

  const allowedWebDavEndpoints = (
    process.env.WHITE_WEBDAV_ENDPOINTS ?? ""
  ).split(",");

  return {
    baseUrl: process.env.BASE_URL,
    apiKey: getApiKey(process.env.OPENAI_API_KEY),

    isStability,
    stabilityUrl: process.env.STABILITY_URL,
    stabilityApiKey: getApiKey(process.env.STABILITY_API_KEY),

    isAzure,
    azureUrl: process.env.AZURE_URL,
    azureApiKey: getApiKey(process.env.AZURE_API_KEY),
    azureApiVersion: process.env.AZURE_API_VERSION,

    isGoogle,
    googleApiKey: getApiKey(process.env.GOOGLE_API_KEY),
    googleUrl: process.env.GOOGLE_URL,

    isAnthropic,
    anthropicApiKey: getApiKey(process.env.ANTHROPIC_API_KEY),
    anthropicUrl: process.env.ANTHROPIC_URL,

    isBaidu,
    baiduUrl: process.env.BAIDU_URL,
    baiduApiKey: getApiKey(process.env.BAIDU_API_KEY),
    baiduSecretKey: process.env.BAIDU_SECRET_KEY,

    isBytedance,
    bytedanceApiKey: getApiKey(process.env.BYTEDANCE_API_KEY),
    bytedanceUrl: process.env.BYTEDANCE_URL,

    isAlibaba,
    alibabaUrl: process.env.ALIBABA_URL,
    alibabaApiKey: getApiKey(process.env.ALIBABA_API_KEY),

    isTencent,
    tencentUrl: process.env.TENCENT_URL,
    tencentSecretKey: getApiKey(process.env.TENCENT_SECRET_KEY),
    tencentSecretId: process.env.TENCENT_SECRET_ID,

    isMoonshot,
    moonshotUrl: process.env.MOONSHOT_URL,
    moonshotApiKey: getApiKey(process.env.MOONSHOT_API_KEY),

    isIflytek,
    iflytekUrl: process.env.IFLYTEK_URL,
    iflytekApiKey: process.env.IFLYTEK_API_KEY,

    isDeepSeek,
    deepseekUrl: process.env.DEEPSEEK_URL,
    deepseekApiKey: getApiKey(process.env.DEEPSEEK_API_KEY),

    isXAI,
    xaiUrl: process.env.XAI_URL,
    xaiApiKey: getApiKey(process.env.XAI_API_KEY),

    isChatGLM,
    chatglmUrl: process.env.CHATGLM_URL,
    chatglmApiKey: getApiKey(process.env.CHATGLM_API_KEY),

    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareKVNamespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID,
    cloudflareKVApiKey: getApiKey(process.env.CLOUDFLARE_KV_API_KEY),
    cloudflareKVTTL: process.env.CLOUDFLARE_KV_TTL,

    isSiliconFlow,
    siliconFlowUrl: process.env.SILICONFLOW_URL,
    siliconFlowApiKey: getApiKey(process.env.SILICONFLOW_API_KEY),

    isAI302,
    ai302Url: process.env.AI302_URL,
    ai302ApiKey: getApiKey(process.env.AI302_API_KEY),

    // CSGPT 专用配置：API 服务地址、API 密钥、模型名称
    csgptBaseUrl: process.env.CSGPT_CS1_BASE_URL,
    csgptApiKey: process.env.CSGPT_CS1_API_KEY,
    csgptModelName,
    csgptUpstreamModelName: process.env.CSGPT_CS1_UPSTREAM_MODEL_NAME,
    csgptCs2BaseUrl: process.env.CSGPT_CS2_BASE_URL,
    csgptCs2ApiKey: process.env.CSGPT_CS2_API_KEY,
    csgptCs2UpstreamModelName: process.env.CSGPT_CS2_UPSTREAM_MODEL_NAME,
    csgptCs3BaseUrl: process.env.CSGPT_CS3_BASE_URL,
    csgptCs3ApiKey: process.env.CSGPT_CS3_API_KEY,
    csgptCs3UpstreamModelName: process.env.CSGPT_CS3_UPSTREAM_MODEL_NAME,

    gtmId: process.env.GTM_ID,
    gaId: process.env.GA_ID || DEFAULT_GA_ID,

    // 认证系统：使用 JWT + PostgreSQL 用户注册/登录
    needCode: false,
    databaseUrl: DATABASE_URL,
    jwtSecret: JWT_SECRET,
    adminUsernames: process.env.ADMIN_USERNAMES || "",

    isVercel: !!process.env.VERCEL,

    hideUserApiKey: !!process.env.HIDE_USER_API_KEY,
    disableGPT4,
    hideBalanceQuery: !process.env.ENABLE_BALANCE_QUERY,
    disableFastLink: !!process.env.DISABLE_FAST_LINK,
    customModels,
    defaultModel,
    allowedWebDavEndpoints,
    enableMcp: process.env.ENABLE_MCP === "true",
  };
};
