import assert from "node:assert/strict";
import { test } from "node:test";
import { designFixture } from "./helpers/design-fixtures";
import { toCSGPTDesignArtifact } from "../app/utils/structured-design";
import {
  buildLaminateCalculationContext,
  detectLaminateAnalysisIntent,
} from "../app/utils/server-laminate-analysis";
import {
  applyCSGPTContextBudget,
  reconcileCSGPTMeasuredBudget,
} from "../app/utils/csgpt-context-budget";
import { countVLLMChatTokens } from "../app/utils/server-vllm-tokenizer";

test("实际分词约束共享窗口且不覆盖当前消息", () => {
  const messages = [{ role: "user", content: "请总结候选及证据边界" }];
  const request = applyCSGPTContextBudget(
    messages,
    { max_tokens: 3153 },
    16384,
  );
  const result = reconcileCSGPTMeasuredBudget(request, 13806, 16384);
  assert.equal(result.rest.max_tokens, 2066);
  assert.deepEqual(result.messages, messages);
  assert.throws(
    () => reconcileCSGPTMeasuredBudget(request, 16000, 16384),
    /没有足够/,
  );
  assert.throws(
    () => reconcileCSGPTMeasuredBudget(request, NaN, 16384),
    /无效/,
  );
});

test("分词请求使用上游模型和实际消息，失败不回退为估算", async () => {
  const original = globalThis.fetch;
  let payload: any;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.invalid/tokenize");
    payload = JSON.parse(String(init?.body));
    return Response.json({ count: 123, max_model_len: 8192 });
  };
  try {
    const result = await countVLLMChatTokens({
      baseUrl: "https://example.invalid/v1",
      model: "adapter",
      messages: [{ role: "user", content: "问题" }],
      contextLength: 16384,
    });
    assert.deepEqual(result, { inputTokens: 123, contextLength: 8192 });
    assert.equal(payload.model, "adapter");
    assert.equal(payload.add_generation_prompt, true);
    globalThis.fetch = async () => new Response("", { status: 503 });
    await assert.rejects(
      countVLLMChatTokens({
        baseUrl: "https://example.invalid/v1",
        model: "adapter",
        messages: [],
        contextLength: 16384,
      }),
      /分词请求失败/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
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
  validateTextCompletion,
  validateTextStream,
} from "../app/utils/server-design-completion";
import {
  CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD,
  CSGPT_DESIGN_ARTIFACT_FIELD,
  CSGPTDesignArtifactAssembler,
  summarizeCSGPTDesignArtifact,
  validateCSGPTDesignArtifact,
  type CSGPTDesignArtifact,
} from "../app/utils/structured-design";

const femFixture = designFixture("fem") as FEMReadyDesignServiceResponse;
const candidates = femFixture.result.candidates;
const artifact: CSGPTDesignArtifact = toCSGPTDesignArtifact(femFixture);
const narrative = "需求与边界\n圆柱段长度 600 mm。";

const designRequest =
  "生成50组 FEM-ready 复合材料耐压壳方案，水深5000米，圆柱壳长度600mm，内半径150mm，两端金属封头。";
test("普通批量设计请求调用概念工具，FEM-ready 使用独立合同", () => {
  const messages = [
    { role: "user", content: designRequest.replace("FEM-ready ", "") },
  ];
  assert.equal(detectFEMReadyDesignIntent(messages), null);
  const intent = detectDeterministicDesignIntent(messages);
  assert.equal(intent?.mode, "concept_layup_enumeration");
  assert.equal(intent?.candidateCount, 50);
  assert.ok(intent?.assumptions.some((item) => item.includes("层数未给定")));
  assert.ok(!intent?.facts.some((item) => item.includes("层")));
});

test("结果讨论和禁止生成的请求不会重新生成候选", () => {
  for (const content of [
    "不要生成50组复合材料耐压壳候选，请解释筛选依据。",
    "请比较已有50组复合材料耐压壳设计方案。",
    "请解释50组复合材料耐压壳方案的屈曲结果。",
    "请解释已生成50组复合材料耐压壳方案的屈曲结果。",
    "不要设计50组复合材料耐压壳方案，只需讨论材料。",
    "无需重新生成50组复合材料耐压壳方案。",
    "生成50组旅游方案。",
  ]) {
    assert.equal(
      detectDeterministicDesignIntent([{ role: "user", content }]),
      null,
    );
  }
});

test("设计动词接受中文和阿拉伯数字，FEM-ready 仍需明确合同", () => {
  for (const count of ["50", "五十"]) {
    const content = `请设计${count}组复合材料耐压壳方案，水深5000米，圆柱壳长度600mm，内半径150mm。`;
    assert.equal(
      detectDeterministicDesignIntent([{ role: "user", content }])
        ?.candidateCount,
      50,
    );
    assert.equal(detectFEMReadyDesignIntent([{ role: "user", content }]), null);
    assert.equal(
      detectFEMReadyDesignIntent([
        { role: "user", content: content + "需要FEM-ready输入包。" },
      ])?.candidateCount,
      50,
    );
  }
});

test("FEM-ready 的结果讨论和否定生成请求不调用生成工具", () => {
  for (const content of [
    designRequest.replace("生成50组", "不要生成50组"),
    designRequest.replace("生成50组", "请比较已有50组"),
    designRequest.replace("生成50组", "请解释50组"),
    designRequest.replace("生成50组", "无需重新设计50组"),
  ]) {
    assert.equal(detectFEMReadyDesignIntent([{ role: "user", content }]), null);
  }
});
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
test("层合板数值请求使用统一服务并保留带符号 ABD 结果", async () => {
  const original = globalThis.fetch;
  let requestPayload: any;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "http://design.test/v1/design/laminate-stiffness");
    requestPayload = JSON.parse(String(init?.body));
    return Response.json({
      status: "passed",
      contract_version: "2",
      calculation_mode: "laminate_abd_coupling",
      engine_version: 2,
      engine_fingerprint: "a".repeat(64),
      calculation_fingerprint: "b".repeat(64),
      result: {
        schema_version: "2",
        calculation_mode: "laminate_abd_coupling",
        reference_plane: "geometric_midplane",
        layer_order: "negative_z_to_positive_z",
        coupling_units: { A: "N/mm", B: "N", D: "N*mm" },
        cases: [
          {
            case_id: "A",
            layer_count: 4,
            sequence_deg: [35, -35, -35, 35],
            angle_sequence_symmetric: true,
            angle_count_balanced: true,
            symmetry_mismatch: null,
            calculated_coupling: {
              A16: 0,
              A26: 0,
              B16: 0,
              B26: 0,
              D16: 1328.4,
              D26: 820.8,
            },
          },
        ],
      },
    });
  };
  process.env.CSGPT_CS2_DESIGN_BASE_URL = "http://design.test";
  try {
    const content = await buildLaminateCalculationContext([
      {
        role: "user",
        content:
          "请复算以下层合截面的 ABD：" +
          JSON.stringify({
            cases: [
              {
                case_id: "A",
                layers: [
                  {
                    angle_deg: 35,
                    thickness_mm: 0.3,
                    Qbar16_MPa: 12300,
                    Qbar26_MPa: 7600,
                  },
                  {
                    angle_deg: -35,
                    thickness_mm: 0.3,
                    Qbar16_MPa: -12300,
                    Qbar26_MPa: -7600,
                  },
                  {
                    angle_deg: -35,
                    thickness_mm: 0.3,
                    Qbar16_MPa: -12300,
                    Qbar26_MPa: -7600,
                  },
                  {
                    angle_deg: 35,
                    thickness_mm: 0.3,
                    Qbar16_MPa: 12300,
                    Qbar26_MPa: 7600,
                  },
                ],
              },
            ],
          }),
      },
    ]);
    assert.ok(content);
    assert.match(content, /D16=1328\.4/);
    assert.match(content, /D26=820\.8/);
    assert.match(content, /Dij = \(1\/3\)/);
    assert.match(content, /h³\/12/);
    assert.match(content, /浮点残差/);
    assert.equal(requestPayload.calculation_mode, "laminate_abd_coupling");
    assert.equal(requestPayload.cases[0].layers.length, 4);
  } finally {
    globalThis.fetch = original;
    delete process.env.CSGPT_CS2_DESIGN_BASE_URL;
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

test("设计说明读取与候选指纹绑定的服务统计", () => {
  const intent = detectFEMReadyDesignIntent([
    { role: "user", content: designRequest },
  ]);
  assert.ok(intent);
  const response = designFixture("fem") as FEMReadyDesignServiceResponse;
  const instruction = buildDesignNarrativeInstruction(intent, response);
  assert.deepEqual(response.interpretation_context.facts["候选来源分组"], {
    同几何历史基线: 8,
    同几何探索: 40,
    最近邻几何迁移: 2,
  });
  assert.match(instruction, /"当前有限元结果":null/);
  assert.match(instruction, /"角度序列镜像对称的候选数量":0/);
  assert.match(instruction, /"正负角层数均衡的候选数量":50/);
  assert.match(instruction, /回答只写工程说明/);
  response.interpretation_context.design_fingerprint = "b".repeat(64);
  assert.throws(
    () => buildDesignNarrativeInstruction(intent, response),
    /解释输入/,
  );
});
const appendix =
  "\n" +
  candidates.map((item) => `| ${item.candidate_id} | 待校核 |`).join("\n");

test("层合板非流式解释校验完成原因且不附加设计工件", () => {
  const data = {
    choices: [{ message: { content: "计算结果" }, finish_reason: "stop" }],
  };
  assert.equal(validateTextCompletion(data), data);
  assert.throws(
    () =>
      validateTextCompletion({
        choices: [{ message: { content: "计算结果" }, finish_reason: null }],
      }),
    /finish_reason/,
  );
  assert.equal(CSGPT_DESIGN_ARTIFACT_FIELD in data, false);
  for (const content of ["", " \n "]) {
    assert.throws(
      () =>
        validateTextCompletion({
          choices: [{ message: { content }, finish_reason: "stop" }],
        }),
      /消息结构无效/,
    );
  }
});
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

test("层合板流式解释保留正文和真实完成原因，缺少完成事件时失败", async () => {
  const complete =
    event(delta("计算结果")) + event(delta("", "length")) + "data: [DONE]\n\n";
  const output = await new Response(
    validateTextStream(inputStream(complete, 1), "csllm"),
  ).text();
  assert.match(output, /计算结果/);
  assert.match(output, /"finish_reason":"length"/);
  assert.doesNotMatch(output, new RegExp(CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD));
  assert.equal(output.endsWith("data: [DONE]\n\n"), true);
  await assert.rejects(
    new Response(
      validateTextStream(
        inputStream(event(delta("片段")) + "data: [DONE]\n\n"),
        "csllm",
      ),
    ).text(),
    /finish_reason/,
  );
});
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
  ["空正文", event(delta(" ", "stop")) + "data: [DONE]\n\n"],
  [
    "非文本正文",
    event({
      choices: [{ index: 0, delta: { content: 123 }, finish_reason: "stop" }],
    }) + "data: [DONE]\n\n",
  ],
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
