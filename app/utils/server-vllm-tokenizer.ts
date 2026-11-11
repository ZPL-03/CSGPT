export class VLLMTokenizerError extends Error {}

export async function countVLLMChatTokens(options: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  contextLength: number;
}) {
  const root = options.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const response = await fetch(`${root}/tokenize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      add_generation_prompt: true,
      add_special_tokens: false,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new VLLMTokenizerError("无法连接后端分词服务，未发送生成请求。");
  });
  if (!response.ok) {
    throw new VLLMTokenizerError(
      `后端分词请求失败（HTTP ${response.status}），未发送未经确认预算的生成请求。`,
    );
  }
  const data = await response.json().catch(() => {
    throw new VLLMTokenizerError("后端分词响应不是有效的 JSON。");
  });
  if (
    !data ||
    !Number.isSafeInteger(data.count) ||
    data.count < 1 ||
    !Number.isSafeInteger(data.max_model_len) ||
    data.max_model_len < 1
  ) {
    throw new VLLMTokenizerError(
      "后端分词响应缺少有效的 count 或 max_model_len。",
    );
  }
  return {
    inputTokens: data.count as number,
    contextLength: Math.min(options.contextLength, data.max_model_len),
  };
}
