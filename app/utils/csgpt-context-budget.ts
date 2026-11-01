import { estimateTokenLength } from "./token";

export const CSGPT_CONTEXT_SAFETY_MARGIN = 512;
export const CSGPT_MIN_OUTPUT_RESERVE = 1024;

function normalizeContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text?: unknown }).text ?? "");
  }
  return content == null ? "" : String(content);
}

function estimateMessageTokens(message: any): number {
  return 4 + estimateTokenLength(normalizeContentToText(message?.content));
}

function estimateMessagesTokens(messages: any[]): number {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
}

function retainMessagesWithinBudget(
  messages: any[],
  tokenBudget: number,
): any[] {
  const preservedIndexes = new Set<number>();
  messages.forEach((message, index) => {
    if (message?.role === "system" || message?.role === "developer") {
      preservedIndexes.add(index);
    }
  });

  const latestMessageIndex = messages.length - 1;
  if (latestMessageIndex >= 0) preservedIndexes.add(latestMessageIndex);

  const selectedIndexes = new Set<number>(preservedIndexes);
  let tokenCount = [...preservedIndexes].reduce(
    (total, index) => total + estimateMessageTokens(messages[index]),
    0,
  );

  if (tokenCount > tokenBudget) {
    throw new Error(
      `CSGPT 请求输入约 ${Math.ceil(
        tokenCount,
      )} tokens，超过可用上下文空间 ${Math.floor(
        tokenBudget,
      )} tokens。请减少附件或关闭部分检索选项后重试。`,
    );
  }

  // 按完整 user-assistant 轮次向前加入历史，避免超长回答被裁掉后留下孤立的旧用户消息，或反向留下没有问题的旧回答。
  let index = latestMessageIndex - 1;
  while (index >= 0) {
    if (selectedIndexes.has(index)) {
      index -= 1;
      continue;
    }
    const group: number[] = [index];
    if (
      messages[index]?.role === "assistant" &&
      index > 0 &&
      messages[index - 1]?.role === "user" &&
      !selectedIndexes.has(index - 1)
    ) {
      group.unshift(index - 1);
    }
    const groupTokens = group.reduce(
      (total, groupIndex) =>
        total + estimateMessageTokens(messages[groupIndex]),
      0,
    );
    if (tokenCount + groupTokens > tokenBudget) break;
    group.forEach((groupIndex) => selectedIndexes.add(groupIndex));
    tokenCount += groupTokens;
    index = group[0] - 1;
  }

  return messages.filter((_message, index) => selectedIndexes.has(index));
}

export function applyCSGPTContextBudget(
  messages: any[],
  rest: Record<string, any>,
  contextLength: number,
) {
  const requestedOutput =
    typeof rest.max_completion_tokens === "number"
      ? rest.max_completion_tokens
      : typeof rest.max_tokens === "number"
      ? rest.max_tokens
      : contextLength;
  const normalizedOutput = Math.max(1, Math.floor(requestedOutput));
  const minimumOutputReserve = Math.min(
    normalizedOutput,
    CSGPT_MIN_OUTPUT_RESERVE,
  );
  const inputBudget = Math.max(
    1,
    contextLength - CSGPT_CONTEXT_SAFETY_MARGIN - minimumOutputReserve,
  );
  const boundedMessages = retainMessagesWithinBudget(messages, inputBudget);
  const inputTokens = estimateMessagesTokens(boundedMessages);
  const availableOutput = Math.max(
    1,
    contextLength - inputTokens - CSGPT_CONTEXT_SAFETY_MARGIN,
  );
  const outputTokens = Math.max(
    1,
    Math.floor(Math.min(normalizedOutput, availableOutput)),
  );
  const boundedRest = { ...rest };

  if (Object.prototype.hasOwnProperty.call(boundedRest, "max_tokens")) {
    boundedRest.max_tokens = outputTokens;
  }
  if (
    Object.prototype.hasOwnProperty.call(boundedRest, "max_completion_tokens")
  ) {
    boundedRest.max_completion_tokens = outputTokens;
  }
  if (
    !Object.prototype.hasOwnProperty.call(boundedRest, "max_tokens") &&
    !Object.prototype.hasOwnProperty.call(boundedRest, "max_completion_tokens")
  ) {
    boundedRest.max_tokens = outputTokens;
  }

  return { messages: boundedMessages, rest: boundedRest };
}
