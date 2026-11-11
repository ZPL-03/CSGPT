import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLaminateAnalysisIntent } from "../app/utils/server-laminate-analysis";
import {
  buildDesignNarrativeInstruction,
  detectDeterministicDesignIntent,
  detectFEMReadyDesignIntent,
  type FEMReadyDesignServiceResponse,
} from "../app/utils/server-deterministic-design";
import {
  appendDesignToOpenAICompletion,
  appendDesignToOpenAIStream,
  prepareDesignNarrativeRest,
} from "../app/utils/server-design-completion";
import {
  CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD,
  CSGPT_DESIGN_ARTIFACT_FIELD,
  CSGPTDesignArtifactAssembler,
  summarizeCSGPTDesignArtifact,
  validateCSGPTDesignArtifact,
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
  result: {
    candidate_count: 50,
    candidates,
    design_fingerprint: "test-design-fingerprint",
  },
};
const narrative = "需求与边界\n圆柱段长度 600 mm。";

const designRequest =
  "生成50组复合材料耐压壳方案，水深5000米，圆柱壳长度600mm，内半径150mm，两端金属封头。";
test("摘要与历史消息不会触发候选生成", () => {
  for (const role of ["system", "assistant", "tool"]) {
    const messages = [
      { role: "user", content: designRequest },
      { role, content: "请总结以上对话" },
    ];
    assert.equal(detectFEMReadyDesignIntent(messages), null);
    assert.equal(detectDeterministicDesignIntent(messages), null);
    assert.equal(
      detectLaminateAnalysisIntent([
        { role: "user", content: "请核对铺层的 ABD 和对称性" },
        { role, content: "请总结以上对话" },
      ]),
      false,
    );
  }
});
test("未指定的边界和层数不会归为用户输入", () => {
  const intent = detectFEMReadyDesignIntent([
    { role: "user", content: designRequest },
  ]);
  assert.ok(intent);
  assert.equal(intent.payload.boundary_conditions, undefined);
  assert.ok(intent.assumptions.some((item) => item.includes("法兰等效约束")));
  assert.ok(intent.assumptions.some((item) => item.includes("40 层")));
  assert.ok(
    !intent.facts.some(
      (item) => item.includes("40") || item.includes("FLANGE"),
    ),
  );
  const explicit = detectFEMReadyDesignIntent([
    { role: "user", content: designRequest + "两端固支，完整物理层数40层。" },
  ]);
  assert.equal(explicit?.payload.boundary_conditions?.type, "END_CLAMPED");
  assert.ok(explicit?.facts.some((item) => item.includes("40")));
});

test("设计说明按实际选中角色区分同几何探索和迁移探索", () => {
  const intent = detectFEMReadyDesignIntent([
    { role: "user", content: designRequest },
  ]);
  assert.ok(intent);
  const response = {
    generation_mode: "fem_ready_cylindrical_shell",
    result: {
      request: {
        load_conditions: { external_pressure_MPa: 50.259081 },
        materials: ["T700/Epoxy", "M40J/TDE-85"],
      },
      source_table: { row_count: 5857 },
      coverage: {
        exact_geometry_row_count: 48,
        exact_geometry_reference_at_or_above_target_count: 8,
      },
      candidates: [
        ...Array.from({ length: 8 }, () => ({
          screening: { candidate_role: "historically_screened_baseline" },
        })),
        ...Array.from({ length: 40 }, () => ({
          screening: { candidate_role: "exact_geometry_exploration" },
        })),
        ...Array.from({ length: 2 }, () => ({
          screening: {
            candidate_role: "nearest_neighbor_transfer_exploration",
          },
        })),
      ],
    },
  } as unknown as FEMReadyDesignServiceResponse;
  const instruction = buildDesignNarrativeInstruction(intent, response);
  assert.match(
    instruction,
    /同几何历史基线 8 组，同几何探索 40 组，最近邻迁移探索 2 组/,
  );
  assert.match(instruction, /不表示已导入 CSDM_cph 或运行有限元/);
  assert.match(instruction, /材料范围严格为 T700\/Epoxy、M40J\/TDE-85/);
});
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
      const assembler = new CSGPTDesignArtifactAssembler();
      let assembled: CSGPTDesignArtifact | undefined;
      for (const item of chunks) assembled = assembler.accept(item);
      assert.deepEqual(
        validateCSGPTDesignArtifact(
          assembled,
          summarizeCSGPTDesignArtifact(artifact),
        ),
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

test("合同分片按编号重组且缺片不能视为完整合同", () => {
  const serialized = JSON.stringify(artifact);
  const a = new CSGPTDesignArtifactAssembler();
  assert.equal(a.started, false);
  const partial = a.accept({
    id: "design",
    index: 1,
    total: 2,
    data: serialized.slice(20),
  });
  assert.equal(partial, undefined);
  assert.equal(a.started, true);
  assert.throws(
    () =>
      validateCSGPTDesignArtifact(
        partial,
        summarizeCSGPTDesignArtifact(artifact),
      ),
    /缺失/,
  );
  assert.deepEqual(
    a.accept({
      id: "design",
      index: 0,
      total: 2,
      data: serialized.slice(0, 20),
    }),
    artifact,
  );
});
for (const invalid of [
  { id: "design", index: -1, total: 2, data: "x" },
  { id: "design", index: 2, total: 2, data: "x" },
  { id: "design", index: 0, total: 0, data: "x" },
  { id: "", index: 0, total: 1, data: "x" },
  { id: "design", index: 0, total: 1, data: "" },
]) {
  test(`无效合同分片明确报错 ${JSON.stringify(invalid)}`, () => {
    assert.throws(
      () => new CSGPTDesignArtifactAssembler().accept(invalid),
      /分片无效/,
    );
  });
}
for (const conflict of [
  { id: "other", index: 1, total: 2, data: "x" },
  { id: "design", index: 1, total: 3, data: "x" },
  { id: "design", index: 0, total: 2, data: "x" },
]) {
  test(`冲突合同分片明确报错 ${JSON.stringify(conflict)}`, () => {
    const a = new CSGPTDesignArtifactAssembler();
    a.accept({ id: "design", index: 0, total: 2, data: "{" });
    assert.throws(() => a.accept(conflict), /冲突/);
  });
}
test("合同解析及正文与响应头不一致不能静默通过", () => {
  assert.throws(() =>
    new CSGPTDesignArtifactAssembler().accept({
      id: "design",
      index: 0,
      total: 1,
      data: "{broken}",
    }),
  );
  assert.throws(
    () =>
      validateCSGPTDesignArtifact({
        ...artifact,
        result: { ...artifact.result, candidate_count: 49 },
      }),
    /数量/,
  );
  const summary = summarizeCSGPTDesignArtifact(artifact);
  for (const mismatch of [
    { ...summary, candidate_count: 49 },
    { ...summary, design_fingerprint: "other" },
    { ...summary, generation_mode: "other" },
  ])
    assert.throws(
      () => validateCSGPTDesignArtifact(artifact, mismatch),
      /不一致/,
    );
});
