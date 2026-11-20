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

function isSystemMessage(message: any): boolean {
  return message?.role === "system" || message?.role === "developer";
}

function requestedOutputTokens(
  rest: Record<string, any>,
  contextLength: number,
) {
  const requested = [rest.max_completion_tokens, rest.max_tokens].find(
    (value) => typeof value === "number",
  );
  return Math.max(1, Math.floor(requested ?? contextLength));
}

function inputTokenBudget(contextLength: number, outputTokens: number) {
  return Math.max(
    1,
    contextLength -
      CSGPT_CONTEXT_SAFETY_MARGIN -
      Math.min(outputTokens, CSGPT_MIN_OUTPUT_RESERVE),
  );
}

/** 工程指令、工件与当前问题确定后，再给完整检索证据分配空间。 */
export function referenceContextTokenBudget(
  messages: any[],
  rest: Record<string, any>,
  contextLength: number,
) {
  const fixed = messages.filter(
    (message, index) =>
      isSystemMessage(message) || index === messages.length - 1,
  );
  return Math.max(
    0,
    inputTokenBudget(
      contextLength,
      requestedOutputTokens(rest, contextLength),
    ) -
      estimateMessagesTokens(fixed) -
      CSGPT_HISTORY_COMPACTION_RESERVE -
      4,
  );
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

  // 工程工件与检索证据作为完整单元保留，其余系统上下文按优先级分配空间。
  const systemIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message, index }) =>
        index !== latestMessageIndex && isSystemMessage(message),
    )
    .sort(
      (left, right) =>
        contextPriority(right.message, right.index) -
          contextPriority(left.message, left.index) || left.index - right.index,
    );

  for (const { message, index } of systemIndexes) {
    const remainingTokens = tokenBudget - tokenCount;
    if (remainingTokens <= 0 && !message._csgptContextAtomic) continue;
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
    // 工程事实与检索单元不可从中间切开，避免丢失数值对应关系和适用条件。
    if (message._csgptContextAtomic) {
      throw new Error(
        "完整工程工件或检索上下文超出窗口，请减少候选数量或关闭部分检索选项。",
      );
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
    if (selectedIndexes.has(index) || isSystemMessage(messages[index])) {
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
  const template = rest.chat_template_kwargs;
  if (
    template !== undefined &&
    (!template || typeof template !== "object" || Array.isArray(template))
  ) {
    throw new Error("chat_template_kwargs 必须是对象。");
  }
  if (
    template?.enable_thinking !== undefined &&
    typeof template.enable_thinking !== "boolean"
  ) {
    throw new Error("enable_thinking 必须是布尔值。");
  }
  const normalizedOutput = requestedOutputTokens(rest, contextLength);
  const inputBudget = inputTokenBudget(contextLength, normalizedOutput);
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
  // CSGPT 默认直接作答；显式启用的 thinking 与正文共用输出预算。
  const boundedRest: Record<string, any> = {
    ...rest,
    chat_template_kwargs: {
      ...template,
      enable_thinking: template?.enable_thinking ?? false,
    },
  };

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

export function reconcileCSGPTMeasuredBudget(
  request: ReturnType<typeof applyCSGPTContextBudget>,
  measuredInputTokens: number,
  contextLength: number,
) {
  if (
    !Number.isSafeInteger(measuredInputTokens) ||
    measuredInputTokens < 1 ||
    !Number.isSafeInteger(contextLength) ||
    contextLength < 1
  ) {
    throw new Error("后端分词计数无效，无法确认上下文预算。");
  }
  const requested =
    request.rest.max_completion_tokens ?? request.rest.max_tokens;
  const available =
    contextLength - measuredInputTokens - CSGPT_CONTEXT_SAFETY_MARGIN;
  if (available < Math.min(requested, CSGPT_MIN_OUTPUT_RESERVE)) {
    throw new Error(
      `后端确认输入为 ${measuredInputTokens} tokens，当前窗口没有足够回答空间。请减少历史或附件内容。`,
    );
  }
  const outputTokens = Math.min(requested, available);
  const rest = { ...request.rest };
  for (const key of ["max_tokens", "max_completion_tokens"]) {
    if (Object.prototype.hasOwnProperty.call(rest, key))
      rest[key] = outputTokens;
  }
  return { messages: request.messages, rest };
}
