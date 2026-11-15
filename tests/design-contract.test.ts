import assert from "node:assert/strict";
import { test } from "node:test";
import fixtures from "./fixtures/design-service.json";
import { designFixture } from "./helpers/design-fixtures";
import { validateCompletedDesignArtifact } from "../app/utils/structured-design";
import {
  buildDesignInterpretationContext,
  validateDesignContract,
  renderDesignTable,
} from "../app/utils/design-contract";
import {
  detectFEMReadyDesignIntent,
  detectDeterministicDesignIntent,
  validateFEMReadyDesignResponse,
  validateDeterministicDesignResponse,
  requestDeterministicDesign,
} from "../app/utils/server-deterministic-design";
import {
  validateCSGPTDesignArtifact,
  CSGPTDesignArtifactAssembler,
  parseCSGPTDesignArtifactHeader,
  CSGPT_DESIGN_ARTIFACT_HEADER,
} from "../app/utils/structured-design";
import { CSGPT_MASKS } from "../app/masks/csgpt";
import {
  CSGPT_SYSTEM_PROMPT,
  CSGPT_LAYUP_RULES,
  CSGPT_NUMERICAL_EVIDENCE_RULE,
} from "../app/prompts/csgpt";

const base =
  "生成2组 FEM-ready 复合材料耐压壳方案，外压20MPa，圆柱壳长度600mm，内半径150mm。";
const custom =
  base +
  "单层厚度0.25mm，初始缺陷比0.002，两端固支，不采用简支，安全系数1.25，材料T700/Epoxy。";
const message = (content: string) => [{ role: "user", content }];

test("否定作用域覆盖并列边界及材料，不跨越另一输入字段", () => {
  for (const clause of [
    "不要采用两端简支",
    "禁止采用两端简支",
    "禁止使用两端简支",
    "不得采用两端简支",
    "严禁选用两端简支",
    "不采用简支和固支",
    "不采用简支、固支",
    "不采用简支，固支",
  ]) {
    assert.throws(
      () => detectFEMReadyDesignIntent(message(base + clause)),
      /边界/,
    );
  }
  const intent = detectFEMReadyDesignIntent(
    message(base + "两端固支，不采用简支，材料T700/Epoxy，不使用IM7/8552。"),
  );
  assert.deepEqual(intent?.payload.materials, ["T700/Epoxy"]);
  assert.equal(intent?.payload.boundary_conditions?.type, "END_CLAMPED");
  assert.throws(
    () => detectFEMReadyDesignIntent(message(base + "只允许材料T300/5228。")),
    /不包含指定材料/,
  );
  assert.deepEqual(
    detectFEMReadyDesignIntent(message(base + "材料m40j/tde-85。"))?.payload
      .materials,
    ["M40J/TDE-85"],
  );
});

test("概念与 FEM 共用材料别名和否定词法", () => {
  for (const detect of [
    detectFEMReadyDesignIntent,
    detectDeterministicDesignIntent,
  ]) {
    for (const exclusion of [
      "禁止使用",
      "不得采用",
      "不要选用",
      "排除",
      "不使用",
    ]) {
      const intent = detect(
        message(base + `材料T700/环氧，${exclusion}IM7/8552。`),
      );
      assert.deepEqual(intent?.payload.materials, ["T700/Epoxy"]);
    }
    assert.deepEqual(
      detect(message(base + "只允许材料IM7-8552。"))?.payload.materials,
      ["IM7-8552"],
    );
  }
  for (const name of ["T300/环氧", "T300", "钛合金"]) {
    assert.throws(
      () => detectFEMReadyDesignIntent(message(base + `只允许材料${name}。`)),
      /材料/,
    );
  }
  assert.deepEqual(
    detectDeterministicDesignIntent(message(base + "材料T300/环氧。"))?.payload
      .materials,
    ["T300/环氧"],
  );
});

test("角度排除作用于对应方向，不覆盖后续肯定选择", () => {
  for (const clause of [
    "仅允许45°、90°，不要采用0°。",
    "不采用0°而采用45°和90°。",
    "禁止使用0度，允许45度和90度。",
  ]) {
    const intent = detectDeterministicDesignIntent(
      message(base.replace("FEM-ready", "") + clause),
    );
    assert.deepEqual(intent?.payload.allowed_angles_deg, [45, 90]);
    assert.deepEqual(intent?.payload.excluded_angles_deg, [0]);
  }
  assert.throws(
    () =>
      detectDeterministicDesignIntent(message(base + "仅允许45°，禁止45°。")),
    /冲突/,
  );
  assert.throws(
    () =>
      detectDeterministicDesignIntent(
        message(base + "排除30°、45°、60°、90°。"),
      ),
    /没有可用/,
  );
  assert.throws(
    () =>
      detectFEMReadyDesignIntent(
        message(custom + "仅允许45°和90°，排除63°和58°。"),
      ),
    /不支持角度筛选/,
  );
});

test("载荷和设计目标拒绝未声明字段，摘要只选取合同字段", () => {
  for (const field of ["load_conditions", "design_targets"] as const) {
    const response = structuredClone(fixtures.fem_custom) as any;
    response.result.request[field]["制造公差/mm"] = 0.008;
    for (const item of response.result.candidates)
      item[field]["制造公差/mm"] = 0.008;
    response.interpretation_context =
      buildDesignInterpretationContext(response);
    assert.ok(
      !JSON.stringify(response.interpretation_context).includes("制造公差/mm"),
    );
    assert.throws(() =>
      validateFEMReadyDesignResponse(
        response,
        detectFEMReadyDesignIntent(message(custom))!,
      ),
    );
  }
});

test("数值完整解析科学计数与分数，绝对缺陷幅值不充当比值", () => {
  for (const value of ["2e-3", "1/500", "0.002"]) {
    assert.equal(
      detectFEMReadyDesignIntent(message(base + `缺陷比${value}。`))?.payload
        .geometry.imperfection_ratio,
      0.002,
    );
  }
  for (const text of [
    "缺陷幅值0.2mm。",
    "缺陷比2e-。",
    "缺陷比0.2毫米。",
    "缺陷比2×10^-3。",
  ])
    assert.throws(
      () => detectFEMReadyDesignIntent(message(base + text)),
      /缺陷/,
    );
  assert.throws(
    () => detectFEMReadyDesignIntent(message(custom + "单层厚度0.5mm。")),
    /不同取值/,
  );
  assert.throws(
    () => detectFEMReadyDesignIntent(message(base + "圆柱壳长度0.7m。")),
    /不同取值/,
  );
  assert.throws(
    () => detectFEMReadyDesignIntent(message(custom + "安全系数1.5。")),
    /不同取值/,
  );
});

test("几何扩展字段和错误边界标签不能进入解释摘要", () => {
  for (const mutate of [
    (v: any) => {
      v.result.candidates[0].geometry["制造公差/mm"] = 0.008;
    },
    (v: any) => {
      v.result.request.boundary_conditions.label = "两端简支";
      for (const item of v.result.candidates)
        item.boundary_conditions.label = "两端简支";
    },
    (v: any) => {
      v.result.request.boundary_conditions.label =
        "![x](https://example.invalid/image)";
      for (const item of v.result.candidates)
        item.boundary_conditions.label =
          v.result.request.boundary_conditions.label;
    },
  ]) {
    const response = structuredClone(fixtures.fem_custom);
    mutate(response);
    response.interpretation_context = buildDesignInterpretationContext(
      response as any,
    ) as any;
    assert.throws(() => validateDesignContract(response));
  }
});

test("同一材料键必须对应相同材料输入", () => {
  const response = structuredClone(fixtures.fem_custom);
  response.result.candidates[1].material_system.E1_GPa = 999;
  assert.throws(() => validateDesignContract(response), /材料.*输入参数/);
});

test("没有响应头或分片的整包工件也须通过完成校验", () => {
  const artifact = structuredClone(fixtures.fem_custom) as any;
  artifact.result.candidates[0] = null;
  assert.throws(
    () =>
      validateCompletedDesignArtifact({
        artifact,
        chunksStarted: false,
        finishReason: "stop",
      }),
    /合同/,
  );
  assert.throws(
    () =>
      validateCompletedDesignArtifact({
        artifact: fixtures.fem_custom,
        chunksStarted: false,
        finishReason: undefined,
      }),
    /完成状态/,
  );
  validateCompletedDesignArtifact({
    artifact: fixtures.fem_custom,
    chunksStarted: false,
    finishReason: "stop",
  });
});

test("系统与专业 Mask 共用铺层和数值依据规则", () => {
  assert.ok(CSGPT_SYSTEM_PROMPT.includes(CSGPT_LAYUP_RULES));
  assert.ok(CSGPT_SYSTEM_PROMPT.includes(CSGPT_NUMERICAL_EVIDENCE_RULE));
  const messages = CSGPT_MASKS.flatMap((mask) => mask.context).map((item) =>
    String(item.content),
  );
  assert.ok(messages.some((item) => item.includes(CSGPT_LAYUP_RULES)));
  assert.equal(
    messages.filter((item) => item.includes(CSGPT_NUMERICAL_EVIDENCE_RULE))
      .length,
    2,
  );
});

test("损坏的设计响应头不被当作没有结构化工件", () => {
  assert.equal(parseCSGPTDesignArtifactHeader(new Response()), null);
  for (const value of [
    "%bad",
    "{}",
    JSON.stringify({
      generation_mode: "fem_ready_cylindrical_shell",
      candidate_count: 1,
      design_fingerprint: "x",
    }),
  ]) {
    assert.throws(
      () =>
        parseCSGPTDesignArtifactHeader(
          new Response(null, {
            headers: { [CSGPT_DESIGN_ARTIFACT_HEADER]: value },
          }),
        ),
      /响应头/,
    );
  }
});

test("正式 Python 响应在服务端和浏览器通过同一合同", () => {
  for (const name of [
    "concept",
    "fem",
    "fem_custom",
    "concept_partial",
  ] as const) {
    const response = designFixture(name);
    assert.deepEqual(
      buildDesignInterpretationContext(response),
      fixtures[name].interpretation_context,
    );
    assert.deepEqual(validateCSGPTDesignArtifact(response), response);
  }
});

test("部分已知参数保留已知取值与缺失数量", () => {
  const facts = designFixture("concept_partial").interpretation_context.facts;
  assert.deepEqual(facts["候选参数取值"], { known_partial: [150] });
  assert.deepEqual(facts["参数未知候选数量"], { known_partial: 1 });
  assert.deepEqual(facts["总厚度/mm"], [12]);
});

test("指定层厚和缺陷通过请求传递到源表筛选", () => {
  const intent = detectFEMReadyDesignIntent(message(custom));
  assert.ok(intent);
  assert.deepEqual(intent.payload.geometry, {
    length_mm: 600,
    radius_mm: 150,
    thickness_mm: 10,
    imperfection_ratio: 0.002,
  });
  assert.equal(intent.payload.boundary_conditions?.type, "END_CLAMPED");
  assert.equal(intent.payload.design_targets?.safety_factor, 1.25);
  validateFEMReadyDesignResponse(designFixture("fem_custom"), intent);
});

test("缺陷比支持小数、百分比和千分比，并拒绝冲突值", () => {
  for (const expression of [
    "0.008",
    "8‰",
    "0.8%",
    "0.8％",
    "千分之8",
    "千分之八",
  ]) {
    const intent = detectFEMReadyDesignIntent(
      message(base + `缺陷比${expression}。`),
    );
    assert.equal(intent?.payload.geometry.imperfection_ratio, 0.008);
  }
  assert.equal(
    detectFEMReadyDesignIntent(message(base))?.payload.geometry
      .imperfection_ratio,
    undefined,
  );
  for (const expression of [
    "缺陷比0",
    "缺陷比-0.008",
    "缺陷比0.008，初始缺陷比0.002",
    "缺陷比千分之8‰",
  ]) {
    assert.throws(
      () => detectFEMReadyDesignIntent(message(base + expression)),
      /缺陷比/,
    );
  }
});

test("边界否定和互相矛盾的厚度不被替换成默认值", () => {
  for (const clause of [
    "两端固支，不采用简支。",
    "不采用简支，采用固支。",
    "clamped, not simply supported.",
  ]) {
    assert.equal(
      detectFEMReadyDesignIntent(message(base + clause))?.payload
        .boundary_conditions?.type,
      "END_CLAMPED",
    );
  }
  for (const clause of [
    "不采用简支。",
    "两端固支，两端简支。",
    "单层厚度0.25mm，总厚度20mm。",
    "层数60层。",
  ]) {
    assert.throws(
      () => detectFEMReadyDesignIntent(message(base + clause)),
      /边界|厚度|层数/,
    );
  }
});

test("概念请求保留外压、安全系数、已知总厚和缺陷", () => {
  const intent = detectDeterministicDesignIntent(
    message(
      "生成2组复合材料耐压壳方案，外压20MPa，安全系数1.25，总厚度12mm，缺陷比8‰。",
    ),
  );
  assert.ok(intent);
  assert.deepEqual(intent.payload.parameter_values, {
    design_pressure_mpa: [20],
    safety_factor: [1.25],
    imperfection_ratio: [0.008],
    total_thickness_mm: [12],
  });
  assert.ok(intent.assumptions.some((item) => item.includes("平均层厚")));
  assert.ok(!intent.assumptions.some((item) => item.includes("总厚度未给定")));
});

test("合法但不属于当前请求的响应被拒绝", () => {
  const response = designFixture("fem_custom");
  const intent = detectFEMReadyDesignIntent(message(custom));
  assert.ok(intent);
  const variations = [
    {
      ...intent.payload,
      geometry: { ...intent.payload.geometry, thickness_mm: 20 },
    },
    {
      ...intent.payload,
      geometry: { ...intent.payload.geometry, imperfection_ratio: 0.008 },
    },
    { ...intent.payload, design_targets: { safety_factor: 1 } },
    { ...intent.payload, materials: ["M40J/TDE-85"] },
    {
      ...intent.payload,
      boundary_conditions: { type: "END_SIMPLY_SUPPORTED" as const },
    },
    { ...intent.payload, structure_form: "两端金属封头、中间复合材料圆柱壳" },
    { ...intent.payload, manufacturing_process: "纤维缠绕" },
  ];
  for (const payload of variations)
    assert.throws(
      () => validateFEMReadyDesignResponse(response, { ...intent, payload }),
      /请求不一致/,
    );
});

const corruptions: Array<[string, (value: any) => void]> = [
  [
    "空候选",
    (v) => {
      v.result.candidates[0] = null;
    },
  ],
  [
    "伪造总厚",
    (v) => {
      v.result.candidates[0].geometry.thickness_mm = 999;
    },
  ],
  [
    "候选缺陷不符",
    (v) => {
      v.result.candidates[0].geometry.imperfection_ratio = 0.008;
    },
  ],
  [
    "候选边界不符",
    (v) => {
      v.result.candidates[0].boundary_conditions.type = "END_SIMPLY_SUPPORTED";
    },
  ],
  [
    "假求解状态",
    (v) => {
      v.result.candidates[0].screening.current_abaqus_status = "completed";
    },
  ],
  [
    "假当前结论",
    (v) => {
      v.result.candidates[0].screening.current_design_verdict = "passed";
    },
  ],
  [
    "无源行",
    (v) => {
      delete v.result.candidates[0].provenance.source_row_number;
    },
  ],
  [
    "无历史压力",
    (v) => {
      delete v.result.candidates[0].provenance.historical_fem_reference
        .ultimate_pressure_MPa;
    },
  ],
  [
    "无穷历史压力",
    (v) => {
      v.result.candidates[0].provenance.historical_fem_reference.ultimate_pressure_MPa =
        Infinity;
    },
  ],
  [
    "错误历史比较",
    (v) => {
      v.result.candidates[0].screening.historical_reference_comparison =
        "at_or_above_target_for_same_geometry";
    },
  ],
  [
    "伪造摘要",
    (v) => {
      v.interpretation_context.facts["总厚度/mm"] = [999];
    },
  ],
  [
    "摘要缺失",
    (v) => {
      v.interpretation_context.facts = { 候选数量: 2 };
    },
  ],
  [
    "摘要伪造制造公差",
    (v) => {
      v.interpretation_context.facts["制造公差"] = "0.008";
    },
  ],
  [
    "非法指纹",
    (v) => {
      v.result.design_fingerprint = "x";
    },
  ],
  [
    "重复设计",
    (v) => {
      v.result.candidates[1] = {
        ...structuredClone(v.result.candidates[0]),
        candidate_id: "TMP_2",
      };
    },
  ],
];
for (const [name, change] of corruptions) {
  test(`拒绝损坏的 FEM 合同：${name}`, () => {
    const response = structuredClone(fixtures.fem_custom);
    change(response);
    assert.throws(() => validateDesignContract(response));
    assert.throws(() => validateCSGPTDesignArtifact(response));
  });
}

test("null 候选不能通过分片组装", () => {
  const value = structuredClone(fixtures.fem_custom) as any;
  value.result.candidates[0] = null;
  assert.throws(
    () =>
      new CSGPTDesignArtifactAssembler().accept({
        id: "null-candidate",
        index: 0,
        total: 1,
        data: JSON.stringify(value),
      }),
    /合同/,
  );
});

test("表格从结构化字段渲染，不使用远端 Markdown", async (t) => {
  const intent = detectFEMReadyDesignIntent(message(custom));
  assert.ok(intent);
  const response = {
    ...structuredClone(fixtures.fem_custom),
    markdown: "| TMP_1 | 总厚度999mm，已通过FEM |",
  };
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  const received = await requestDeterministicDesign(intent, {
    baseUrl: "https://design.invalid",
  });
  const text = renderDesignTable(received);
  assert.ok(text.includes("TMP_2"));
  assert.ok(!text.includes("999"));
  assert.ok(!text.includes("已通过FEM"));
});

test("概念响应逐项绑定请求，不接受另一个任务的参数", () => {
  const intent = detectDeterministicDesignIntent(
    message(
      "设计50组复合材料耐压壳方案，水深5000米，圆柱壳长度600mm，内半径150mm。",
    ),
  );
  assert.ok(intent);
  validateDeterministicDesignResponse(designFixture("concept"), intent);
  assert.throws(
    () =>
      validateDeterministicDesignResponse(designFixture("concept"), {
        ...intent,
        payload: { ...intent.payload, ply_thickness_mm: 0.2 },
      }),
    /请求不一致/,
  );
});
