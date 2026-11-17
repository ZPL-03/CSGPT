import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLaminateCalculationContext } from "../app/utils/server-laminate-analysis";

const layer = {
  angle_deg: 45,
  thickness_mm: 0.3,
  Qbar16_MPa: 100,
  Qbar26_MPa: 20,
};
const section = { case_id: "A", layers: [layer] };
const messages = (cases: unknown[]) => [
  { role: "user", content: "计算层合板 ABD：" + JSON.stringify({ cases }) },
];

function response() {
  return {
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
      abd_contract: {
        integral_weights: { A: "1", B: "z", D: "z^2" },
        discrete_formulas: {
          A: "Aij = sum(Qbarij,k * (z_upper - z_lower))",
          B: "Bij = sum(Qbarij,k * (z_upper^2 - z_lower^2) / 2)",
          D: "Dij = sum(Qbarij,k * (z_upper^3 - z_lower^3) / 3)",
        },
        coupling_definitions: {
          A16_A26: "面内拉伸-剪切耦合",
          B16_B26: "膜力-曲率与弯矩-中面应变的交叉耦合",
          D16_D26: "弯曲-扭转耦合",
        },
        stiffness_scope: {
          model: "平面应力经典层合板线弹性截面刚度",
          does_not_prove: ["壳体承载", "屈曲压力", "材料失效", "整机安全"],
          structural_check_requires: [
            "几何",
            "载荷",
            "边界条件",
            "初始缺陷",
            "材料失效模型",
            "有限元或试验结果",
          ],
        },
      },
      cases: [
        {
          case_id: "A",
          layer_count: 1,
          sequence_deg: [45],
          angle_sequence_symmetric: true,
          angle_count_balanced: false,
          symmetry_mismatch: null,
          calculated_coupling: {
            A16: 30,
            A26: 6,
            B16: 0,
            B26: 0,
            D16: 0.225,
            D26: 0.045,
          },
          contributions: [
            {
              z_lower_mm: -0.15,
              z_upper_mm: 0.15,
              A16: 30,
              A26: 6,
              B16: 0,
              B26: 0,
              D16: 0.225,
              D26: 0.045,
            },
          ],
        },
      ],
    },
  };
}

test("理论问题不被固定计算文本替代，也不复用历史数值输入", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("不应调用服务");
  };
  try {
    for (const content of [
      "ABD 是什么？",
      "均衡铺层和对称铺层有何区别？",
      "解释层合板屈曲机理",
    ]) {
      assert.equal(
        await buildLaminateCalculationContext([
          ...messages([section]),
          { role: "user", content },
        ]),
        null,
      );
    }
  } finally {
    globalThis.fetch = fetch;
  }
});

test("不丢弃批量请求中的无效截面，不把 null 或布尔值转成数值", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("不应调用服务");
  };
  try {
    for (const invalid of [
      null,
      { case_id: "bad", layers: [] },
      { case_id: "bad", layers: [{ ...layer, thickness_mm: null }] },
      { case_id: "bad", layers: [{ ...layer, angle_deg: false }] },
      { case_id: "bad", layers: [{ ...layer, thickness_mm: 0 }] },
      { case_id: "bad", layers: [{ angle_deg: 45, thickness_mm: 0.3 }] },
      {
        case_id: "bad",
        sequence_deg: [45, -45],
        ply_thickness_mm: 0.3,
        Qbar16_MPa: [100],
        Qbar26_MPa: [20, -20],
      },
      {
        ...section,
        material: { E1_GPa: 100, E2_GPa: 10, G12_GPa: 5, nu12: 0.3 },
      },
      section,
    ]) {
      await assert.rejects(
        buildLaminateCalculationContext(messages([section, invalid])),
        (error: Error) => !error.message.includes("不应调用服务"),
      );
    }
  } finally {
    globalThis.fetch = fetch;
  }
});

test("响应必须保留全部截面、层序、单位、有限数值和计算指纹", async () => {
  const fetch = globalThis.fetch;
  const base = process.env.CSGPT_CS2_DESIGN_BASE_URL;
  process.env.CSGPT_CS2_DESIGN_BASE_URL = "http://calculation.test";
  try {
    for (const mutate of [
      (r: any) => {
        r.result.cases = [];
      },
      (r: any) => {
        r.result.cases[0].case_id = "B";
      },
      (r: any) => {
        r.result.cases[0].sequence_deg = [-45];
      },
      (r: any) => {
        r.result.cases[0].calculated_coupling.D16 = null;
      },
      (r: any) => {
        r.result.coupling_units.B = "N/mm";
      },
      (r: any) => {
        r.result.abd_contract.integral_weights.B = "z^2";
      },
      (r: any) => {
        delete r.result.abd_contract;
      },
      (r: any) => {
        delete r.calculation_fingerprint;
      },
      (r: any) => {
        r.result.cases[0] = null;
      },
      (r: any) => {
        delete r.result.cases[0].symmetry_mismatch;
      },
      (r: any) => {
        delete r.result.cases[0].contributions;
      },
      (r: any) => {
        r.result.cases[0].contributions[0].z_upper_mm = 10;
      },
      (r: any) => {
        r.result.cases[0].contributions[0].D16 = 0;
      },
    ]) {
      const data = response();
      mutate(data);
      globalThis.fetch = async () => Response.json(data);
      await assert.rejects(
        buildLaminateCalculationContext(messages([section])),
        /合同|不一致/,
      );
    }
    globalThis.fetch = async () => Response.json(response());
    const content = await buildLaminateCalculationContext(messages([section]));
    const context = JSON.parse(content!.slice(content!.indexOf("{")));
    assert.deepEqual(context.request.cases, [section]);
    assert.deepEqual(context.result, response().result);
    assert.ok(content?.includes("b".repeat(64)));
    const reordered = response();
    reordered.result.abd_contract = Object.fromEntries(
      Object.entries(reordered.result.abd_contract).reverse(),
    ) as typeof reordered.result.abd_contract;
    reordered.result.abd_contract.integral_weights = { D: "z^2", B: "z", A: "1" };
    globalThis.fetch = async () => Response.json(reordered);
    assert.ok(await buildLaminateCalculationContext(messages([section])));
  } finally {
    globalThis.fetch = fetch;
    if (base === undefined) delete process.env.CSGPT_CS2_DESIGN_BASE_URL;
    else process.env.CSGPT_CS2_DESIGN_BASE_URL = base;
  }
});

test("请求不存在的候选编号时明确失败", async () => {
  await assert.rejects(
    buildLaminateCalculationContext([
      {
        role: "assistant",
        content: "| 编号 | 显式铺层 |\n| TMP_1 | [45/-45] |",
      },
      { role: "user", content: "核对 TMP_1 和 TMP_2 的对称性" },
    ]),
    /缺少/,
  );
});

test("候选核对采用最近的候选内容，不按表格或 JSON 格式排序", async () => {
  const fetch = globalThis.fetch;
  const base = process.env.CSGPT_CS2_DESIGN_BASE_URL;
  process.env.CSGPT_CS2_DESIGN_BASE_URL = "http://calculation.test";
  const table = (angle: number) =>
    `| 编号 | 显式铺层 |\n| tmp_1 | [${angle}] |`;
  const json = (angle: number) =>
    JSON.stringify({
      result: {
        candidates: [{ candidate_id: "tmp_1", layup: { angles_deg: [angle] } }],
      },
    });
  try {
    for (const history of [
      [table(30), json(45)],
      [json(30), table(45)],
    ]) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        assert.deepEqual(payload.cases, [
          { case_id: "TMP_1", layers: [{ angle_deg: 45 }] },
        ]);
        calls += 1;
        const data: any = response();
        data.calculation_mode = data.result.calculation_mode =
          "laminate_layup_semantics";
        data.result.cases[0].case_id = "TMP_1";
        data.result.cases[0].calculated_coupling = null;
        data.result.cases[0].contributions = [];
        return Response.json(data);
      };
      const text = await buildLaminateCalculationContext([
        ...history.map((content) => ({ role: "assistant", content })),
        { role: "user", content: "核对 tmp_1 的对称性" },
      ]);
      assert.equal(calls, 1);
      assert.ok(text?.includes("TMP_1"));
    }
  } finally {
    globalThis.fetch = fetch;
    if (base === undefined) delete process.env.CSGPT_CS2_DESIGN_BASE_URL;
    else process.env.CSGPT_CS2_DESIGN_BASE_URL = base;
  }
});

test("非对称结果必须携带与请求层序一致的镜像证据", async () => {
  const fetch = globalThis.fetch;
  const base = process.env.CSGPT_CS2_DESIGN_BASE_URL;
  process.env.CSGPT_CS2_DESIGN_BASE_URL = "http://calculation.test";
  const input = [
    { role: "assistant", content: "| 编号 | 显式铺层 |\n| TMP_1 | [45/-45] |" },
    { role: "user", content: "核对 TMP_1 的对称性" },
  ];
  try {
    const data: any = response();
    data.calculation_mode = data.result.calculation_mode =
      "laminate_layup_semantics";
    Object.assign(data.result.cases[0], {
      case_id: "TMP_1",
      layer_count: 2,
      sequence_deg: [45, -45],
      angle_sequence_symmetric: false,
      angle_count_balanced: true,
      calculated_coupling: null,
      contributions: [],
    });
    for (const mismatch of [
      undefined,
      null,
      {},
      { first_layer: 0, mirror_layer: 3, first_angle: 45, mirror_angle: -45 },
      { first_layer: 1, mirror_layer: 1, first_angle: 45, mirror_angle: -45 },
      { first_layer: 1, mirror_layer: 2, first_angle: 30, mirror_angle: -45 },
    ]) {
      data.result.cases[0].symmetry_mismatch = mismatch;
      globalThis.fetch = async () => Response.json(data);
      await assert.rejects(
        buildLaminateCalculationContext(input),
        /镜像校核证据不一致/,
      );
    }
    data.result.cases[0].symmetry_mismatch = {
      first_layer: 1,
      mirror_layer: 2,
      first_angle: 45,
      mirror_angle: -45,
    };
    const text = await buildLaminateCalculationContext(input);
    assert.ok(text?.includes("角度序列对称=false"));
    assert.ok(text?.includes("第 1 层 45° 与第 2 层 -45°"));
    assert.ok(!text?.includes("每一层与中面镜像层一致"));
  } finally {
    globalThis.fetch = fetch;
    if (base === undefined) delete process.env.CSGPT_CS2_DESIGN_BASE_URL;
    else process.env.CSGPT_CS2_DESIGN_BASE_URL = base;
  }
});
