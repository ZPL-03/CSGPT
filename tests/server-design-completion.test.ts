import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendDesignToOpenAICompletion,
  appendDesignToOpenAIStream,
  prepareDesignNarrativeRest,
} from "../app/utils/server-design-completion";
import {
  CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD,
  CSGPT_DESIGN_ARTIFACT_FIELD,
  type CSGPTDesignArtifact,
} from "../app/utils/structured-design";

const candidates = Array.from({ length: 50 }, (_, index) => ({
  candidate_id: `TMP_${index + 1}`,
  layup: {
    angles_deg: Array.from({ length: 40 }, () => [30, -30, 80, -80]).flat(),
  },
  note: "待有限元校核的候选，不构成安全结论。",
}));
const artifact: CSGPTDesignArtifact = {
  status: "passed",
  generation_mode: "fem_ready_cylindrical_shell",
  result: { candidate_count: 50, candidates },
};
const narrative = "需求与边界\n圆柱段长度 600 mm。";
const appendix =
  "\n" +
  candidates.map((item) => `| ${item.candidate_id} | 待校核 |`).join("\n");
const event = (payload: unknown, newline = "\n") =>
  `data: ${JSON.stringify(payload)}${newline}${newline}`;
const delta = (content: string, reason: unknown = null) => ({
  choices: [{ index: 0, delta: { content }, finish_reason: reason }],
});
function inputStream(text: string, fragmentSize = 19) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += fragmentSize) {
        controller.enqueue(bytes.slice(offset, offset + fragmentSize));
      }
      controller.close();
    },
  });
}
async function outputEvents(text: string, fragmentSize?: number) {
  const body = appendDesignToOpenAIStream(
    inputStream(text, fragmentSize),
    appendix,
    "csllm",
    artifact,
  );
  const output = await new Response(body).text();
  assert.ok(output.endsWith("data: [DONE]\n\n"));
  return output
    .trim()
    .split("\n\n")
    .slice(0, -1)
    .map((entry) => JSON.parse(entry.slice(6)));
}

for (const reason of ["stop", "length", "content_filter", "tool_calls"]) {
  test(`非流式保留 ${reason} 并完整追加表格和合同`, () => {
    const input = {
      choices: [
        {
          message: { role: "assistant", content: narrative },
          finish_reason: reason,
        },
      ],
    };
    const output = appendDesignToOpenAICompletion(input, appendix, artifact);
    assert.equal(output.choices[0].finish_reason, reason);
    assert.equal(output.choices[0].message.content, narrative + appendix);
    assert.equal(input.choices[0].message.content, narrative);
    assert.deepEqual(output[CSGPT_DESIGN_ARTIFACT_FIELD], artifact);
  });
  for (const size of [1, 19, 65536]) {
    test(`流式 ${reason}，字节分片 ${size}，完整发送 TMP_50 和合同后才结束`, async () => {
      const events = await outputEvents(
        event(delta(narrative), "\r\n") +
          event({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }) +
          event({ choices: [], usage: { completion_tokens: 15 } }) +
          "data: [DONE]\n\n",
        size,
      );
      const content = events
        .map((item) => item.choices?.[0]?.delta?.content || "")
        .join("");
      assert.equal(content, narrative + appendix);
      assert.ok(content.includes("TMP_50"));
      assert.deepEqual(
        events
          .flatMap((item) => item.choices || [])
          .map((item) => item.finish_reason)
          .filter(Boolean),
        [reason],
      );
      assert.equal(events.at(-1).choices[0].finish_reason, reason);
      const chunks = events
        .map((item) => item[CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD])
        .filter(Boolean);
      assert.ok(chunks.length > 1);
      assert.deepEqual(
        chunks.map((item) => item.index),
        Array.from({ length: chunks.length }, (_, i) => i),
      );
      assert.ok(chunks.every((item) => item.total === chunks.length));
      assert.deepEqual(
        JSON.parse(chunks.map((item) => item.data).join("")),
        artifact,
      );
    });
  }
}
for (const reason of [null, undefined, "", 0]) {
  test(`非流式缺失或无效完成状态 ${String(reason)} 不伪装为成功`, () => {
    assert.throws(
      () =>
        appendDesignToOpenAICompletion(
          {
            choices: [
              { message: { content: narrative }, finish_reason: reason },
            ],
          },
          appendix,
          artifact,
        ),
      /finish_reason/,
    );
  });
}
for (const [name, text] of [
  ["缺失完成状态", event(delta(narrative)) + "data: [DONE]\n\n"],
  ["缺失结束标记", event(delta(narrative, "stop"))],
  [
    "错误事件",
    event({ error: { message: "upstream failure" } }) + "data: [DONE]\n\n",
  ],
  ["JSON 损坏", "data: {broken}\n\ndata: [DONE]\n\n"],
  [
    "重复完成状态",
    event(delta(narrative, "stop")) +
      event(delta("", "length")) +
      "data: [DONE]\n\n",
  ],
  [
    "结束后仍有内容",
    event(delta(narrative)) +
      "data: [DONE]\n\n" +
      event(delta("unexpected", "stop")),
  ],
] as const) {
  test(`流式 ${name} 明确失败`, async () => {
    await assert.rejects(outputEvents(text));
  });
}
test("上游连接失败不返回正常完成", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("connection lost"));
    },
  });
  await assert.rejects(
    new Response(
      appendDesignToOpenAIStream(stream, appendix, "csllm", artifact),
    ).text(),
    /connection lost/,
  );
});
test("客户端取消后取消上游读取", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await appendDesignToOpenAIStream(stream, appendix, "csllm", artifact).cancel(
    "user cancelled",
  );
  assert.equal(cancelled, true);
});
test("说明输出预算受共享窗口约束且尊重较小用户预算", () => {
  assert.equal(prepareDesignNarrativeRest({}).max_tokens, 4096);
  assert.equal(
    prepareDesignNarrativeRest({ max_tokens: 8000 }).max_tokens,
    4096,
  );
  const result = prepareDesignNarrativeRest({
    max_tokens: 3000,
    max_completion_tokens: 512,
    temperature: 0.8,
  });
  assert.equal(result.max_tokens, 512);
  assert.equal(result.temperature, 0.3);
  assert.equal("max_completion_tokens" in result, false);
  assert.throws(() => prepareDesignNarrativeRest({ n: 2 }), /单个/);
});
