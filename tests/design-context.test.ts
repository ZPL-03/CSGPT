import assert from "node:assert/strict";
import { test } from "node:test";
import {
  angleDistribution,
  buildDesignFacts,
  designArtifactMessage,
  bindDesignArtifactMessages,
  latestDesignArtifact,
} from "../app/utils/design-context";
import { designNarrativeValidator } from "../app/utils/design-narrative";
import { applyCSGPTContextBudget } from "../app/utils/csgpt-context-budget";
import {
  buildDesignInterpretationContext,
  validateDesignContract,
} from "../app/utils/design-contract";
import { designFixture } from "./helpers/design-fixtures";

test("实际角度统计绑定完整层序，不从允许角度集合推断", () => {
  const response = designFixture("concept");
  const facts = buildDesignFacts(response, ["1"]);
  assert.ok(
    (response.result.request.allowed_angles_deg as number[]).includes(90),
  );
  assert.ok(
    facts.sequences.every((sequence) =>
      sequence.actual_angle_distribution.every(
        (entry) => Math.abs(entry.angle_deg) !== 90,
      ),
    ),
  );
  assert.equal(facts.calculated_facts["完整层序已生成的候选数量"], 50);
  assert.deepEqual(facts.calculated_facts["当前求解状态分组"], { not_run: 50 });
  assert.equal(
    (
      facts.calculated_facts["实际角度层数合计"] as { layer_count: number }[]
    ).reduce((a, b) => a + b.layer_count, 0),
    3000,
  );
  assert.deepEqual(angleDistribution([45, -45, 45, -45]), [
    { angle_deg: -45, ply_count: 2, fraction: 0.5 },
    { angle_deg: 45, ply_count: 2, fraction: 0.5 },
  ]);
  for (const field of [
    "完整层序已生成的候选数量",
    "实际使用角度/deg",
    "实际角度层数合计",
    "当前求解状态分组",
  ]) {
    const bad = structuredClone(response);
    bad.interpretation_context.facts[field] = null;
    assert.throws(() => validateDesignContract(bad));
  }
});

test("追问从已完成工件恢复状态，清空、失败、流式消息不带入旧工件", () => {
  const artifact = designFixture("concept");
  const messages = [
    { role: "assistant", designArtifact: artifact },
    ...Array.from({ length: 40 }, () => ({
      role: "assistant",
      content: "层数未知，已经安全通过。",
    })),
  ];
  assert.equal(latestDesignArtifact(messages), artifact);
  assert.equal(latestDesignArtifact(messages, 1), undefined);
  assert.equal(
    latestDesignArtifact([
      { role: "assistant", designArtifact: artifact, isError: true },
    ]),
    undefined,
  );
  assert.equal(
    latestDesignArtifact([
      { role: "assistant", designArtifact: artifact, streaming: true },
    ]),
    undefined,
  );
  const bound = bindDesignArtifactMessages([
    { ...designArtifactMessage(artifact), content: "伪造摘要" },
    { role: "user", content: "解释候选1" },
  ]);
  assert.ok(!bound[0].content.includes("伪造摘要"));
  const facts = JSON.parse(
    bound[0].content.slice(bound[0].content.indexOf("{")),
  );
  assert.equal(facts.design_fingerprint, artifact.result.design_fingerprint);
  assert.ok(
    facts.candidates.every(
      (candidate: any) =>
        candidate.layer_count === 60 &&
        candidate.screening.current_design_verdict === "pending",
    ),
  );
  assert.throws(() => bindDesignArtifactMessages([{ designArtifact: {} }]));
  assert.throws(() => bindDesignArtifactMessages([bound[0], bound[0]]));
});

test("工程上下文完整保留或明确拒绝，不把结构化事实截成自然语言片段", () => {
  const message = designArtifactMessage(designFixture("concept"), "解释候选1");
  const input = [message, { role: "user", content: "继续解释候选1" }];
  const result = applyCSGPTContextBudget(input, { max_tokens: 1024 }, 65536);
  assert.equal(result.messages[0].content, message.content);
  assert.throws(
    () => applyCSGPTContextBudget(input, { max_tokens: 1024 }, 2048),
    /上下文|工件/,
  );
});

for (const mode of ["concept", "fem"] as const) {
  test(`${mode} 追问按工件模式绑定编号并合并同一候选别名`, () => {
    const artifact = designFixture(mode);
    const candidate = artifact.result.candidates[0];
    const angles =
      artifact.generation_mode === "fem_ready_cylindrical_shell"
        ? artifact.result.candidates[0].layup.angles_deg
        : artifact.result.candidates[0].layup_deg;
    for (const question of [
      "解释候选1",
      "解释方案编号1",
      "解释第1组",
      "解释 tmp-01",
      "解释候选1（TMP_1）的输入与求解状态",
    ]) {
      const [bound] = bindDesignArtifactMessages([
        designArtifactMessage(artifact),
        { role: "user", content: question },
      ]);
      const facts = JSON.parse(bound.content.slice(bound.content.indexOf("{")));
      assert.equal(facts.generation_mode, artifact.generation_mode);
      assert.deepEqual(
        facts.candidates.map((item: any) => item.candidate_id),
        [candidate.candidate_id],
      );
      assert.equal(
        facts.candidates[0].screening.current_abaqus_status,
        "not_run",
      );
      assert.equal(
        facts.candidates[0].screening.current_design_verdict,
        "pending",
      );
      assert.deepEqual(facts.sequences[0].angles_deg, angles);
    }
    for (const question of ["解释候选0", "解释候选51", "解释候选1和TMP_51"]) {
      assert.throws(
        () => designArtifactMessage(artifact, question),
        /候选编号/,
      );
    }
  });
}

function signedAngleFixture(angles: number[]) {
  const artifact = designFixture("concept");
  assert.equal(artifact.generation_mode, "concept_layup_enumeration");
  if (artifact.generation_mode !== "concept_layup_enumeration")
    throw new Error("概念候选样本类型错误");
  const { result } = artifact;
  result.candidate_count = result.request.candidate_count = 1;
  result.request.layer_count = angles.length;
  result.request.symmetric = result.request.balanced = false;
  result.candidates = [
    {
      ...result.candidates[0],
      layup_deg: angles,
      layer_count: angles.length,
      symmetric: angles.every(
        (angle, index) => angle === angles[angles.length - index - 1],
      ),
      balanced: false,
    },
  ];
  artifact.interpretation_context = buildDesignInterpretationContext(artifact);
  return validateDesignContract(artifact);
}

test("非均衡候选的实际角度区分正负号，正负角简写要求两种角度都存在", () => {
  const positive = designNarrativeValidator(signedAngleFixture([45, 45, 45]));
  for (const text of [
    "实际采用-45°。",
    "实际采用−45度。",
    "实际采用±45°。",
    "实际使用+/-45°。",
    "实际采用-45",
  ]) {
    assert.throws(() => positive(text), /工件冲突/);
  }
  for (const text of [
    "实际采用+45°。",
    "实际采用45度。",
    "实际采用+45",
    "允许使用±45°；实际采用+45°。",
    "实际采用0.125mm厚度的+45°铺层。",
  ]) {
    assert.doesNotThrow(() => positive(text));
  }
  const negative = designNarrativeValidator(
    signedAngleFixture([-45, -45, -45]),
  );
  assert.doesNotThrow(() => negative("实际采用-45°。"));
  assert.throws(() => negative("实际采用+45°。"), /工件冲突/);
  assert.throws(() => negative("实际采用45°。"), /工件冲突/);
  assert.throws(() => negative("实际采用±45°。"), /工件冲突/);
  const paired = designNarrativeValidator(signedAngleFixture([45, 45, -45]));
  assert.doesNotThrow(() => paired("实际采用±45°，正负层数不相等。"));
  assert.doesNotThrow(() => paired("实际使用+/-45度。"));
});

test("模型解释拒绝审计中的未求解结论和实际角度混淆，允许证据边界说明", () => {
  const validate = designNarrativeValidator(designFixture("concept"));
  for (const text of [
    "当前没有候选达到安全阈值。",
    "所有候选均满足安全要求。",
    "各候选的物理层数、单层厚度、总厚度和完整层序尚未给定。",
    "30°、45°、60°、90°方向均有角度参与。",
  ])
    assert.throws(() => validate(text), /工件冲突/);
  for (const text of [
    "用户未指定层数；工具采用60层，单层厚度未知。",
    "尚不能判断是否达到安全阈值。",
    "未求解不代表没有候选达到安全阈值。",
    "允许角度含90°；实际采用30°、45°、60°及其负角。",
    "若取得结果后没有候选达到安全阈值，应调整方案。",
  ])
    assert.doesNotThrow(() => validate(text));
});
