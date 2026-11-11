import {
  CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD,
  CSGPT_DESIGN_ARTIFACT_FIELD,
  type CSGPTDesignArtifact,
} from "./structured-design";

const DESIGN_NARRATIVE_MAX_TOKENS = 4096;
const CONTENT_CHUNK_CHARS = 1200;
const ARTIFACT_CHUNK_CHARS = 12000;

export function prepareDesignNarrativeRest(rest: Record<string, any>) {
  if (rest.n !== undefined && rest.n !== 1) {
    throw new Error("确定性设计回答只支持单个完成结果。");
  }
  const result = { ...rest };
  const requestedTokens = rest.max_completion_tokens ?? rest.max_tokens;
  delete result.max_completion_tokens;
  result.max_tokens =
    typeof requestedTokens === "number" &&
    Number.isFinite(requestedTokens) &&
    requestedTokens > 0
      ? Math.max(
          1,
          Math.min(Math.floor(requestedTokens), DESIGN_NARRATIVE_MAX_TOKENS),
        )
      : DESIGN_NARRATIVE_MAX_TOKENS;
  const requestedTemperature = Number(rest.temperature);
  result.temperature = Number.isFinite(requestedTemperature)
    ? Math.min(Math.max(requestedTemperature, 0), 0.3)
    : 0.2;
  return result;
}

function requireFinishReason(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(
      "设计说明上游缺少有效的 finish_reason，无法确认回答是否完整。",
    );
  }
  return reason;
}

export function appendDesignToOpenAICompletion(
  data: any,
  appendix: string,
  designArtifact: CSGPTDesignArtifact,
) {
  const choice = data?.choices?.[0];
  if (
    data?.error ||
    data?.choices?.length !== 1 ||
    typeof choice?.message?.content !== "string"
  ) {
    throw new Error("设计说明上游返回的非流式消息结构无效。");
  }
  const finishReason = requireFinishReason(choice.finish_reason);
  return {
    ...data,
    [CSGPT_DESIGN_ARTIFACT_FIELD]: designArtifact,
    choices: [
      {
        ...choice,
        message: {
          ...choice.message,
          content: choice.message.content + appendix,
        },
        finish_reason: finishReason,
      },
    ],
  };
}

export function appendDesignToOpenAIStream(
  upstreamBody: ReadableStream<Uint8Array>,
  appendix: string,
  model: string,
  designArtifact: CSGPTDesignArtifact,
) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const completionId = `chatcmpl-csgpt-design-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let upstreamFinishReason: string | null = null;
      let receivedDone = false;
      const send = (payload: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };
      const chunk = (delta: object, finishReason: string | null = null) => ({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      });
      const forwardEvent = (event: string) => {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) return;
        if (data === "[DONE]") {
          receivedDone = true;
          return;
        }
        if (receivedDone)
          throw new Error("设计说明上游在结束标记后仍返回数据。");
        const payload = JSON.parse(data);
        if (payload?.error) throw new Error("设计说明上游返回错误事件。");
        if (!Array.isArray(payload?.choices) || payload.choices.length > 1) {
          throw new Error("设计说明上游 SSE 事件结构无效。");
        }
        for (const choice of payload.choices) {
          if (choice.index !== 0)
            throw new Error("设计说明上游返回多个完成结果。");
          if (upstreamFinishReason && Object.keys(choice.delta || {}).length) {
            throw new Error("设计说明上游在完成结果后仍返回消息内容。");
          }
          if (choice.finish_reason != null) {
            if (upstreamFinishReason) {
              throw new Error("设计说明上游重复返回完成结果。");
            }
            upstreamFinishReason = requireFinishReason(choice.finish_reason);
            // 完成事件在全部附录发送后发出，客户端不应提前结束读取。
            choice.finish_reason = null;
          }
        }
        send(payload);
      };

      try {
        while (!cancelled) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let separator = buffer.match(/\r?\n\r?\n/);
          while (separator?.index !== undefined) {
            forwardEvent(buffer.slice(0, separator.index));
            buffer = buffer.slice(separator.index + separator[0].length);
            separator = buffer.match(/\r?\n\r?\n/);
          }
          if (done) break;
        }
        if (cancelled) return;
        if (buffer.trim()) forwardEvent(buffer);
        const finishReason = requireFinishReason(upstreamFinishReason);
        if (!receivedDone) throw new Error("设计说明上游缺少 SSE 结束标记。");

        for (
          let offset = 0;
          offset < appendix.length;
          offset += CONTENT_CHUNK_CHARS
        ) {
          send(
            chunk({
              content: appendix.slice(offset, offset + CONTENT_CHUNK_CHARS),
            }),
          );
        }
        const serialized = JSON.stringify(designArtifact);
        const total = Math.ceil(serialized.length / ARTIFACT_CHUNK_CHARS);
        for (let index = 0; index < total; index += 1) {
          send({
            ...chunk({}),
            [CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD]: {
              id: completionId,
              index,
              total,
              data: serialized.slice(
                index * ARTIFACT_CHUNK_CHARS,
                (index + 1) * ARTIFACT_CHUNK_CHARS,
              ),
            },
          });
        }
        send(chunk({}, finishReason));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        if (!cancelled) {
          await reader.cancel(error).catch(() => undefined);
          controller.error(error);
        }
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason);
    },
  });
}
