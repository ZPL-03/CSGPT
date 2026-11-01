import { estimateTokenLength } from "./token";

export const CSGPT_CONTEXT_SAFETY_MARGIN = 512;
export const CSGPT_MIN_OUTPUT_RESERVE = 1024;
const CSGPT_HISTORY_COMPACTION_RESERVE = 1024;

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

function contentWithTokenBudget(content: unknown, tokenBudget: number): string {
  const text = normalizeContentToText(content);
  if (estimateTokenLength(text) + 4 <= tokenBudget) return text;

  const marker = "\n[上下文内容已按共享窗口预算截取]\n";
  const availableTokens = Math.max(
    1,
    tokenBudget - 4 - estimateTokenLength(marker),
  );
  const targetCharacters = Math.max(
    1,
    Math.floor(
      (text.length * availableTokens) / Math.max(1, estimateTokenLength(text)),
    ),
  );
  const headLength = Math.max(1, Math.ceil(targetCharacters * 0.75));
  const tailLength = Math.max(0, targetCharacters - headLength);
  let candidate = `${text.slice(0, headLength)}${marker}`;
  if (tailLength > 0) candidate += text.slice(-tailLength);

  while (
    estimateTokenLength(candidate) + 4 > tokenBudget &&
    candidate.length > marker.length + 1
  ) {
    const head = Math.max(
      1,
      Math.floor((candidate.length - marker.length) * 0.72),
    );
    const tail = Math.max(0, candidate.length - marker.length - head - 1);
    candidate = `${text.slice(0, head)}${marker}${
      tail ? text.slice(-tail) : ""
    }`;
  }
  return candidate;
}

function withCompactedContent(message: any, tokenBudget: number): any {
  return {
    ...message,
    content: contentWithTokenBudget(message?.content, tokenBudget),
  };
}

function compactHistoryGroup(
  group: number[],
  messages: any[],
  tokenBudget: number,
) {
  const perMessageBudget = Math.max(8, Math.floor(tokenBudget / group.length));
  return group.map((index, groupIndex) => {
    const remainingBudget = Math.max(
      8,
      tokenBudget - perMessageBudget * groupIndex,
    );
    const messageBudget =
      groupIndex === group.length - 1
        ? remainingBudget
        : Math.min(perMessageBudget, remainingBudget);
    return [
      index,
      withCompactedContent(messages[index], messageBudget),
    ] as const;
  });
}

function contextPriority(message: any, index: number): number {
  if (typeof message?._csgptContextPriority === "number") {
    return message._csgptContextPriority;
  }
  if (message?.role === "system" || message?.role === "developer") {
    return index === 0 ? 100 : 50;
  }
  return 0;
}

function retainMessagesWithinBudget(
  messages: any[],
  tokenBudget: number,
): any[] {
  const latestMessageIndex = messages.length - 1;
  const latestMessage = messages[latestMessageIndex];
  const latestMessageTokens =
    latestMessageIndex >= 0 ? estimateMessageTokens(latestMessage) : 0;
  if (latestMessageTokens > tokenBudget) {
    throw new Error(
      `CSGPT 请求输入约 ${Math.ceil(
        latestMessageTokens,
      )} tokens，超过可用上下文空间 ${Math.floor(
        tokenBudget,
      )} tokens。请减少附件或关闭部分检索选项后重试。`,
    );
  }

  const selectedIndexes = new Set<number>();
  const selectedMessages = new Map<number, any>();
  let tokenCount = 0;

  if (latestMessageIndex >= 0) {
    selectedIndexes.add(latestMessageIndex);
    selectedMessages.set(latestMessageIndex, latestMessage);
    tokenCount = latestMessageTokens;
  }

  // 系统提示词分为核心约束和可压缩增强上下文。优先保留高优先级内容，
  // 低优先级检索文本在剩余预算中截取，而不是让整条请求因检索结果过长失败。
  const systemIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message, index }) =>
        index !== latestMessageIndex &&
        (message?.role === "system" || message?.role === "developer"),
    )
    .sort(
      (left, right) =>
        contextPriority(right.message, right.index) -
          contextPriority(left.message, left.index) || left.index - right.index,
    );

  for (const { message, index } of systemIndexes) {
    const remainingTokens = tokenBudget - tokenCount;
    if (remainingTokens <= 0) break;
    const targetRemainingTokens =
      contextPriority(message, index) <= 20
        ? Math.max(8, remainingTokens - CSGPT_HISTORY_COMPACTION_RESERVE)
        : remainingTokens;
    const fullTokens = estimateMessageTokens(message);
    if (fullTokens <= targetRemainingTokens) {
      selectedIndexes.add(index);
      selectedMessages.set(index, message);
      tokenCount += fullTokens;
      continue;
    }

    const minimumTokens = Math.min(96, targetRemainingTokens);
    if (minimumTokens < 8) continue;
    const compacted = withCompactedContent(message, targetRemainingTokens);
    const compactedTokens = estimateMessageTokens(compacted);
    if (compactedTokens <= targetRemainingTokens) {
      selectedIndexes.add(index);
      selectedMessages.set(index, compacted);
      tokenCount += compactedTokens;
    }
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
    if (tokenCount + groupTokens <= tokenBudget) {
      group.forEach((groupIndex) => selectedIndexes.add(groupIndex));
      tokenCount += groupTokens;
    } else {
      const compactBudget = tokenBudget - tokenCount;
      if (compactBudget < 32) break;
      const compactedGroup = compactHistoryGroup(
        group,
        messages,
        compactBudget,
      );
      const compactedTokens = compactedGroup.reduce(
        (total, [, message]) => total + estimateMessageTokens(message),
        0,
      );
      if (compactedTokens > compactBudget) break;
      compactedGroup.forEach(([groupIndex, message]) => {
        selectedIndexes.add(groupIndex);
        selectedMessages.set(groupIndex, message);
      });
      tokenCount += compactedTokens;
    }
    index = group[0] - 1;
  }

  return messages
    .map((message, messageIndex) => ({ message, messageIndex }))
    .filter(({ messageIndex }) => selectedIndexes.has(messageIndex))
    .map(
      ({ message, messageIndex }) =>
        selectedMessages.get(messageIndex) || message,
    );
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
