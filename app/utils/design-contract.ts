import { z } from "zod";

const number = z.number().finite();
const positive = number.positive();
const count = number.int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scalar = z.union([z.string(), number, z.boolean(), z.null()]);
const angle = number.min(-90).max(90);
const sequence = z.array(angle).min(1).max(512);
const boundaryLabels = {
  END_CLAMPED: "两端固支",
  END_SIMPLY_SUPPORTED: "两端简支",
  FLANGE_CONSTRAINED: "端部法兰等效约束",
};
const boundary = z
  .object({
    type: z.enum(["END_CLAMPED", "END_SIMPLY_SUPPORTED", "FLANGE_CONSTRAINED"]),
    basis: z.enum(["user_input", "modeling_assumption"]),
    label: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()
  .refine(
    (value) => value.label === boundaryLabels[value.type],
    "边界标签与类型不一致",
  );
const load = z
  .object({
    type: z.literal("external_pressure"),
    service_depth_m: positive.nullable(),
    external_pressure_MPa: positive,
    seawater_density_kg_per_m3: positive,
    gravity_m_per_s2: positive,
    pressure_basis: z.enum([
      "user_supplied_external_pressure",
      "rho_g_h_gauge_differential",
    ]),
  })
  .strict();
const targets = z
  .object({
    ultimate_pressure_min_MPa: positive,
    service_pressure_MPa: positive,
    safety_factor: number.min(1).nullable(),
    primary_objective: z.string().min(1),
  })
  .strict();
const geometry = z
  .object({
    length_mm: positive,
    radius_mm: positive,
    radius_reference: z.literal("inner"),
    thickness_mm: positive,
    alpha_deg: angle,
    beta_deg: angle,
    imperfection_ratio: positive,
  })
  .strict();
const material = z
  .object({
    name: z.string().min(1),
    material_key: z.string().min(1),
    density_kg_per_m3: positive,
    E1_GPa: positive,
    E2_GPa: positive,
    G12_GPa: positive,
    nu12: positive,
    Xt_MPa: positive,
    Xc_MPa: positive,
    Yt_MPa: positive,
    Yc_MPa: positive,
    S_MPa: positive,
  })
  .passthrough();
const roles = z.enum([
  "historically_screened_baseline",
  "exact_geometry_exploration",
  "nearest_neighbor_transfer_exploration",
]);
const comparisons = z.enum([
  "at_or_above_target_for_same_geometry",
  "below_target_for_same_geometry",
  "not_applicable_after_geometry_transfer",
]);
const roleLabels = {
  historically_screened_baseline: "同几何历史基线",
  exact_geometry_exploration: "同几何探索",
  nearest_neighbor_transfer_exploration: "最近邻几何迁移",
};
const comparisonLabels = {
  at_or_above_target_for_same_geometry: "同几何历史值不低于目标",
  below_target_for_same_geometry: "同几何历史值低于目标",
  not_applicable_after_geometry_transfer: "几何迁移后不适用",
};
const context = z.object({
  schema_version: z.literal("1"),
  design_fingerprint: hash,
  facts: z.record(z.string(), z.unknown()),
});
const inputProvenance = z
  .object({
    user_fixed: z.array(z.string().min(1)),
    tool_selected: z.array(z.string().min(1)),
  })
  .strict()
  .optional();
const conceptRequest = z
  .object({
    schema_version: z.literal("1"),
    candidate_count: count.max(1000),
    layer_count: count.max(512),
    allowed_angles_deg: z.array(number.min(0).max(90)).min(1),
    excluded_angles_deg: z.array(number.min(0).max(90)),
    symmetric: z.boolean(),
    balanced: z.boolean(),
    materials: z.array(z.string().min(1)).min(1),
    ply_thickness_mm: positive.nullable(),
    parameter_values: z.record(z.string(), z.array(scalar).min(1)),
    non_neutral_angle_family_count: count.nullable().optional(),
  })
  .passthrough();
const conceptCandidate = z
  .object({
    candidate_id: count,
    material: z.string().min(1),
    parameters: z.record(z.string(), scalar),
    layup_deg: sequence,
    layer_count: count,
    ply_thickness_mm: positive.nullable(),
    total_thickness_mm: positive.nullable(),
    symmetric: z.boolean(),
    balanced: z.boolean(),
  })
  .passthrough();
const conceptResponse = z
  .object({
    status: z.literal("passed"),
    generation_mode: z.literal("concept_layup_enumeration"),
    engine_version: count,
    engine_fingerprint: hash,
    interpretation_context: context,
    input_provenance: inputProvenance,
    result: z
      .object({
        schema_version: z.literal("1"),
        engine_version: count,
        engine_fingerprint: hash,
        request: conceptRequest,
        candidate_count: count,
        candidates: z.array(conceptCandidate).min(1),
        design_fingerprint: hash,
        evidence_boundary: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();
const femRequest = z
  .object({
    schema_version: z.literal("2"),
    generation_mode: z.literal("fem_ready_cylindrical_shell"),
    candidate_count: count.max(60),
    geometry: z.object({
      length_mm: positive,
      radius_mm: positive,
      thickness_mm: z.array(positive).min(1).nullable(),
      imperfection_ratio: positive.optional(),
    }),
    load_conditions: load,
    boundary_conditions: boundary,
    design_targets: targets,
    materials: z.array(z.string().min(1)).min(1),
    structure_form: z.string().min(1),
    manufacturing_process: z.string().min(1),
  })
  .passthrough();
const femCandidate = z
  .object({
    contract_version: z.literal("1"),
    candidate_id: z.string(),
    design_revision_id: z.string().regex(/^DR_[a-f0-9]{64}$/),
    hull_type: z.literal("CYLINDRICAL"),
    geometry,
    layup: z
      .object({
        ply_count: z.literal(40),
        angles_deg: sequence.length(40),
        ply_thickness_mm: positive,
        symmetric: z.boolean(),
        balanced: z.literal(true),
      })
      .passthrough(),
    material_system: material,
    load_conditions: load,
    boundary_conditions: boundary,
    design_targets: targets,
    analysis: z
      .object({
        model_scope: z.literal("composite_cylindrical_shell"),
        analysis_type: z.literal(
          "linear_buckling_plus_first_mode_imperfection_riks",
        ),
        use_user_subroutine: z.literal(false),
      })
      .passthrough(),
    provenance: z
      .object({
        source_sha256: hash,
        source_row_number: count,
        geometry_match: z.enum(["exact", "nearest_neighbor_transfer"]),
        source_geometry: z
          .object({
            length_mm: positive,
            radius_mm: positive,
            radius_reference: z.literal("inner"),
          })
          .passthrough(),
        historical_fem_reference: z
          .object({
            status: z.literal("screening_reference_only_not_current_run"),
            ultimate_pressure_MPa: positive,
            linear_buckling_pressure_MPa: positive,
          })
          .passthrough(),
        source_laminate_stiffness_validation: z
          .object({
            status: z.literal("recomputed_from_explicit_sequence"),
            max_abs_error: number.nonnegative(),
            absolute_tolerance: positive,
          })
          .passthrough(),
      })
      .passthrough(),
    screening: z
      .object({
        candidate_role: roles,
        historical_reference_comparison: comparisons,
        historical_reference_meets_target_at_source_geometry: z.boolean(),
        current_abaqus_status: z.literal("not_run"),
        current_design_verdict: z.literal("pending"),
      })
      .passthrough(),
    fem_readiness: z
      .object({
        current_fem_run_required: z.literal(true),
        status: z.literal("ready_for_current_cylindrical_shell_fem"),
      })
      .passthrough(),
  })
  .passthrough();
const femResponse = z
  .object({
    input_provenance: inputProvenance,
    status: z.literal("passed"),
    generation_mode: z.literal("fem_ready_cylindrical_shell"),
    contract_version: z.literal("1"),
    interpretation_context: context,
    result: z
      .object({
        schema_version: z.literal("2"),
        contract_version: z.literal("1"),
        generation_mode: z.literal("fem_ready_cylindrical_shell"),
        request: femRequest,
        source_table: z
          .object({ sha256: hash, row_count: count })
          .passthrough(),
        coverage: z
          .object({
            exact_geometry_row_count: number.int().nonnegative(),
            exact_geometry_reference_at_or_above_target_count: number
              .int()
              .nonnegative(),
            reference_result_status: z.literal(
              "screening_reference_only_not_current_run",
            ),
            selected_candidate_role_counts: z.record(
              roles,
              number.int().nonnegative(),
            ),
          })
          .passthrough(),
        candidate_count: count,
        candidates: z.array(femCandidate).min(1),
        design_fingerprint: hash,
        evidence_boundary: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export type DeterministicDesignServiceResponse = z.infer<
  typeof conceptResponse
>;
export type FEMReadyDesignServiceResponse = z.infer<typeof femResponse>;
export type DesignServiceResponse =
  | DeterministicDesignServiceResponse
  | FEMReadyDesignServiceResponse;

// 对象键顺序不参与合同比较；数组保留物理层序和候选顺序。
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown, label: string) {
  if (stableJson(left) !== stableJson(right))
    throw new Error(`${label}不一致。`);
}

function close(left: number, right: number, label: string) {
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    Math.abs(left - right) > 1e-6
  ) {
    throw new Error(`${label}不一致。`);
  }
}

function symmetric(values: number[]) {
  return values.every(
    (value, index) => value === values[values.length - index - 1],
  );
}

function balanced(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (value === 0 || Math.abs(value) === 90) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].every(([value, count]) => count === counts.get(-value));
}

function tally(values: string[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}

function distinct(values: unknown[]) {
  const unique = new Map(
    values
      .filter((value) => value != null)
      .map((value) => [stableJson(value), value]),
  );
  const result = [...unique.values()];
  return result.every((value) => typeof value === "number")
    ? (result as number[]).sort((a, b) => a - b)
    : [...unique.keys()].sort().map((key) => unique.get(key));
}

const parameterLabels: Record<string, string> = {
  design_pressure_mpa: "外压/MPa",
  safety_factor: "安全系数",
  inner_radius_mm: "内半径/mm",
  radius_mm: "内半径/mm",
  length_mm: "圆柱段长度/mm",
  total_thickness_mm: "总厚度/mm",
  thickness_mm: "总厚度/mm",
  imperfection_ratio: "分析缺陷比",
  initial_defect_per_mille: "分析缺陷比/千分比",
  alpha_deg: "alpha/deg",
  beta_deg: "beta/deg",
};

// 摘要由候选逐项复算，服务端声明的事实不能替代结构化输入。
export function buildDesignInterpretationContext(
  response: DesignServiceResponse,
) {
  const fem = response.generation_mode === "fem_ready_cylindrical_shell";
  const rows: Record<string, unknown>[] = fem
    ? response.result.candidates.map((item) => item.geometry)
    : response.result.candidates.map((item) => item.parameters);
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const shared: Record<string, unknown> = {};
  const varying: Record<string, unknown> = {};
  const unknown: Record<string, number> = {};
  for (const key of fields) {
    const values = distinct(rows.map((row) => row[key]));
    const missing = rows.filter((row) => row[key] == null).length;
    const label = parameterLabels[key] || key;
    if (values.length === 1 && !missing) shared[label] = values[0];
    else if (values.length) varying[label] = values;
    if (missing) unknown[label] = missing;
  }
  const plies = fem
    ? response.result.candidates.map((item) => item.layup.ply_count)
    : response.result.candidates.map((item) => item.layer_count);
  const thicknesses = fem
    ? response.result.candidates.map((item) => item.layup.ply_thickness_mm)
    : response.result.candidates.map((item) => item.ply_thickness_mm);
  const totals = fem
    ? response.result.candidates.map((item) => item.geometry.thickness_mm)
    : response.result.candidates.map((item) => item.total_thickness_mm);
  const layups = fem
    ? response.result.candidates.map((item) => item.layup)
    : response.result.candidates;
  const sequences = fem
    ? response.result.candidates.map((item) => item.layup.angles_deg)
    : response.result.candidates.map((item) => item.layup_deg);
  const allAngles = sequences.flat();
  const facts: Record<string, unknown> = {
    候选数量: rows.length,
    材料分组: tally(
      fem
        ? response.result.candidates.map((item) => item.material_system.name)
        : response.result.candidates.map((item) => item.material),
    ),
    各候选共同参数: shared,
    候选参数取值: varying,
    参数未知候选数量: unknown,
    物理层数: distinct(plies),
    完整层序已生成的候选数量: sequences.filter(
      (angles, index) => angles.length === plies[index],
    ).length,
    "实际使用角度/deg": distinct(allAngles),
    实际角度层数合计: (distinct(allAngles) as number[]).map((angle_deg) => ({
      angle_deg,
      layer_count: allAngles.filter((angle) => angle === angle_deg).length,
    })),
    "单层厚度/mm": distinct(thicknesses),
    单层厚度未知的候选数量: thicknesses.filter((value) => value === null)
      .length,
    "总厚度/mm": distinct(totals),
    总厚度未知的候选数量: totals.filter((value) => value === null).length,
    角度序列镜像对称的候选数量: layups.filter((item) => item.symmetric).length,
    正负角层数均衡的候选数量: layups.filter((item) => item.balanced).length,
    当前有限元结果: null,
    当前求解状态分组: { not_run: rows.length },
  };
  if (fem) {
    const { candidates, request } = response.result;
    Object.assign(facts, {
      候选来源分组: tally(
        candidates.map((item) => roleLabels[item.screening.candidate_role]),
      ),
      历史参考与目标比较: tally(
        candidates.map(
          (item) =>
            comparisonLabels[item.screening.historical_reference_comparison],
        ),
      ),
      当前求解状态分组: tally(
        candidates.map((item) => item.screening.current_abaqus_status),
      ),
      载荷条件: {
        type: request.load_conditions.type,
        service_depth_m: request.load_conditions.service_depth_m,
        external_pressure_MPa: request.load_conditions.external_pressure_MPa,
        seawater_density_kg_per_m3:
          request.load_conditions.seawater_density_kg_per_m3,
        gravity_m_per_s2: request.load_conditions.gravity_m_per_s2,
        pressure_basis: request.load_conditions.pressure_basis,
      },
      边界条件: {
        type: request.boundary_conditions.type,
        basis: request.boundary_conditions.basis,
        label: boundaryLabels[request.boundary_conditions.type],
      },
      设计目标: {
        ultimate_pressure_min_MPa:
          request.design_targets.ultimate_pressure_min_MPa,
        service_pressure_MPa: request.design_targets.service_pressure_MPa,
        safety_factor: request.design_targets.safety_factor,
        primary_objective: request.design_targets.primary_objective,
      },
      历史参考结果: "源行有限元值用于候选初筛，当前设计修订尚未求解。",
      分析缺陷定义:
        "候选几何中的 imperfection_ratio 是有限元初始缺陷输入，制造公差另由工艺和检测依据确定。",
      计算对象: "复合材料圆柱段，金属封头和连接未进入该子模型。",
    });
  } else {
    facts["允许角度族/deg"] = response.result.request.allowed_angles_deg;
    facts["排除角度/deg"] = response.result.request.excluded_angles_deg;
  }
  return {
    schema_version: "1" as const,
    design_fingerprint: response.result.design_fingerprint,
    facts,
  };
}

export function validateDesignInterpretationContext(
  response: DesignServiceResponse,
) {
  same(
    response.interpretation_context,
    buildDesignInterpretationContext(response),
    "候选解释输入与设计结果",
  );
}

// 服务端接收和浏览器组装使用同一合同，检查形状、输入绑定、算术和结果状态。
export function validateDesignContract(value: unknown): DesignServiceResponse {
  const parsed = z
    .discriminatedUnion("generation_mode", [conceptResponse, femResponse])
    .safeParse(value);
  if (!parsed.success) {
    const paths = parsed.error.issues
      .map((issue) => issue.path.join(".") || "响应对象")
      .slice(0, 6);
    throw new Error(`结构化设计合同字段缺失或无效：${paths.join("、")}。`);
  }
  const response = parsed.data;
  const result = response.result;
  same(result.candidate_count, result.candidates.length, "候选数量");
  same(result.request.candidate_count, result.candidate_count, "请求候选数量");
  if (response.generation_mode === "concept_layup_enumeration") {
    const { request, candidates } = response.result;
    same(response.engine_version, response.result.engine_version, "引擎版本");
    same(
      response.engine_fingerprint,
      response.result.engine_fingerprint,
      "引擎指纹",
    );
    const seen = new Set<string>();
    for (const [index, item] of candidates.entries()) {
      same(item.candidate_id, index + 1, "候选编号");
      same(
        item.material,
        request.materials[index % request.materials.length],
        "候选材料",
      );
      same(item.layer_count, request.layer_count, "物理层数");
      same(item.layup_deg.length, request.layer_count, "铺层序列长度");
      same(
        Object.keys(item.parameters).sort(),
        Object.keys(request.parameter_values).sort(),
        "候选参数字段",
      );
      for (const [key, values] of Object.entries(request.parameter_values)) {
        if (!values.includes(item.parameters[key]))
          throw new Error(`候选参数 ${key} 不在请求范围内。`);
      }
      if (
        item.layup_deg.some(
          (a) =>
            !request.allowed_angles_deg.includes(Math.abs(a)) ||
            request.excluded_angles_deg.includes(Math.abs(a)),
        )
      ) {
        throw new Error("铺层含允许集合外或已排除的角度。");
      }
      same(item.symmetric, symmetric(item.layup_deg), "角度序列对称性");
      same(item.balanced, balanced(item.layup_deg), "正负角层数均衡性");
      if (
        (request.symmetric && !item.symmetric) ||
        (request.balanced && !item.balanced)
      )
        throw new Error("铺层不满足请求约束。");
      same(item.ply_thickness_mm, request.ply_thickness_mm, "单层厚度");
      const explicit = item.parameters.total_thickness_mm;
      const calculated =
        item.ply_thickness_mm === null
          ? null
          : item.ply_thickness_mm * item.layer_count;
      const expected = typeof explicit === "number" ? explicit : calculated;
      if (typeof explicit === "number" && calculated !== null)
        close(explicit, calculated, "指定总厚度与层厚乘积");
      if (expected === null) same(item.total_thickness_mm, null, "未知总厚度");
      else close(item.total_thickness_mm ?? NaN, expected, "总厚度");
      const key = stableJson(item.layup_deg);
      if (seen.has(key)) throw new Error("候选包含重复铺层。");
      seen.add(key);
    }
  } else {
    const { request, candidates, source_table, coverage } = response.result;
    const pressure = request.load_conditions.external_pressure_MPa;
    close(
      request.design_targets.service_pressure_MPa,
      pressure,
      "目标服务压力",
    );
    close(
      request.design_targets.ultimate_pressure_min_MPa,
      pressure * (request.design_targets.safety_factor ?? 1),
      "安全系数与目标压力",
    );
    if (
      request.load_conditions.pressure_basis === "rho_g_h_gauge_differential"
    ) {
      const { service_depth_m, seawater_density_kg_per_m3, gravity_m_per_s2 } =
        request.load_conditions;
      close(
        pressure,
        ((service_depth_m ?? NaN) *
          seawater_density_kg_per_m3 *
          gravity_m_per_s2) /
          1e6,
        "水深与静水压力",
      );
    }
    const revisions = new Set<string>();
    const materialRecords = new Map<string, unknown>();
    const designs = new Set<string>();
    for (const [index, item] of candidates.entries()) {
      same(item.candidate_id, `TMP_${index + 1}`, "候选编号");
      const materialKey = item.material_system.material_key;
      if (materialRecords.has(materialKey)) {
        same(
          item.material_system,
          materialRecords.get(materialKey),
          `材料 ${materialKey} 的输入参数`,
        );
      }
      materialRecords.set(materialKey, item.material_system);
      const g = item.geometry;
      same(g.length_mm, request.geometry.length_mm, "圆柱段长度");
      same(g.radius_mm, request.geometry.radius_mm, "内半径");
      if (
        request.geometry.thickness_mm &&
        !request.geometry.thickness_mm.includes(g.thickness_mm)
      )
        throw new Error("候选总厚度与请求不一致。");
      if (request.geometry.imperfection_ratio !== undefined)
        close(
          g.imperfection_ratio,
          request.geometry.imperfection_ratio,
          "分析缺陷比",
        );
      if (!request.materials.includes(item.material_system.name))
        throw new Error("候选材料与请求不一致。");
      same(item.load_conditions, request.load_conditions, "候选载荷");
      same(item.boundary_conditions, request.boundary_conditions, "候选边界");
      same(item.design_targets, request.design_targets, "候选设计目标");
      same(
        item.layup.symmetric,
        symmetric(item.layup.angles_deg),
        "角度序列对称性",
      );
      same(
        item.layup.balanced,
        balanced(item.layup.angles_deg),
        "正负角层数均衡性",
      );
      close(
        g.thickness_mm,
        item.layup.ply_thickness_mm * item.layup.ply_count,
        "总厚度与层厚乘积",
      );
      same(item.provenance.source_sha256, source_table.sha256, "候选来源指纹");
      if (item.provenance.source_row_number > source_table.row_count)
        throw new Error("源行超出表格范围。");
      const validation = item.provenance.source_laminate_stiffness_validation;
      if (validation.max_abs_error > validation.absolute_tolerance)
        throw new Error("源行刚度复算误差超出容差。");
      const source = item.provenance.source_geometry;
      const exact =
        source.length_mm === g.length_mm && source.radius_mm === g.radius_mm;
      same(
        item.provenance.geometry_match,
        exact ? "exact" : "nearest_neighbor_transfer",
        "来源几何匹配",
      );
      const meets =
        item.provenance.historical_fem_reference.ultimate_pressure_MPa >=
        item.design_targets.ultimate_pressure_min_MPa;
      same(
        item.screening.historical_reference_meets_target_at_source_geometry,
        meets,
        "历史参考目标比较",
      );
      same(
        item.screening.candidate_role,
        !exact
          ? "nearest_neighbor_transfer_exploration"
          : meets
          ? "historically_screened_baseline"
          : "exact_geometry_exploration",
        "候选来源角色",
      );
      same(
        item.screening.historical_reference_comparison,
        !exact
          ? "not_applicable_after_geometry_transfer"
          : meets
          ? "at_or_above_target_for_same_geometry"
          : "below_target_for_same_geometry",
        "历史参考适用性",
      );
      const physical = stableJson([
        g,
        item.layup.angles_deg,
        item.material_system.material_key,
      ]);
      if (revisions.has(item.design_revision_id) || designs.has(physical))
        throw new Error("候选包含重复设计。");
      revisions.add(item.design_revision_id);
      designs.add(physical);
    }
    const counts = tally(
      candidates.map((item) => item.screening.candidate_role),
    );
    for (const role of roles.options)
      same(
        coverage.selected_candidate_role_counts[role],
        counts[role] || 0,
        "候选角色统计",
      );
    if (
      coverage.exact_geometry_reference_at_or_above_target_count >
        coverage.exact_geometry_row_count ||
      coverage.exact_geometry_row_count > source_table.row_count
    )
      throw new Error("来源覆盖统计超出源表范围。");
  }
  validateDesignInterpretationContext(response);
  return response;
}

function cell(value: unknown) {
  if (value === null) return "未给定";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value)
    .replace(/[\\`*[\]{}()!]/g, "\\$&")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
}

function table(headers: string[], rows: unknown[][]) {
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.map(cell).join(" | ")} |`)
    .join("\n");
}

function summaryNumber(value: number) {
  // 非零小量使用科学计数法，避免显示舍入把它写成精确零。
  const rounded = value.toFixed(1);
  return value !== 0 && Number(rounded) === 0
    ? value.toExponential(1)
    : String(Number(rounded));
}

function displayParameter(key: string, value: unknown) {
  if (typeof value !== "number") return value;
  const pressure = /pressure.*_(?:m|k|g)?pa$/i.test(key);
  const geometry = key.endsWith("_mm") && !key.includes("thickness");
  return pressure || geometry ? summaryNumber(value) : value;
}

// 表格仅使用合同字段，远端 Markdown 不参与界面展示。
export function renderDesignTable(response: DesignServiceResponse) {
  if (response.generation_mode === "concept_layup_enumeration") {
    const keys = Object.keys(response.result.request.parameter_values).sort();
    return table(
      [
        "编号",
        "材料",
        ...keys.map((key) => parameterLabels[key] || key),
        "层数",
        "单层厚度/mm",
        "总厚度/mm",
        "角度序列对称",
        "正负角层数均衡",
        "逐层角度（外到内）",
      ],
      response.result.candidates.map((item) => [
        item.candidate_id,
        item.material,
        ...keys.map((key) => displayParameter(key, item.parameters[key])),
        item.layer_count,
        item.ply_thickness_mm,
        item.total_thickness_mm,
        item.symmetric,
        item.balanced,
        `[${item.layup_deg.join("/")}]`,
      ]),
    );
  }
  const { request, candidates } = response.result;
  const rows = candidates.map((item) => [
    item.candidate_id,
    roleLabels[item.screening.candidate_role],
    item.material_system.name,
    summaryNumber(item.geometry.length_mm),
    summaryNumber(item.geometry.radius_mm),
    item.geometry.thickness_mm,
    item.geometry.imperfection_ratio,
    item.layup.ply_thickness_mm,
    item.layup.symmetric,
    item.layup.balanced,
    `[${item.layup.angles_deg.join("/")}]`,
    comparisonLabels[item.screening.historical_reference_comparison],
    summaryNumber(
      item.provenance.historical_fem_reference.ultimate_pressure_MPa,
    ),
    item.provenance.source_row_number,
  ]);
  const materials = [
    ...new Map(
      candidates.map((item) => [
        item.material_system.material_key,
        item.material_system,
      ]),
    ).values(),
  ];
  const fields = [
    "name",
    "density_kg_per_m3",
    "E1_GPa",
    "E2_GPa",
    "G12_GPa",
    "nu12",
    "Xt_MPa",
    "Xc_MPa",
    "Yt_MPa",
    "Yc_MPa",
    "S_MPa",
  ];
  return (
    `服务外压 ${summaryNumber(
      request.load_conditions.external_pressure_MPa,
    )} MPa，极限压力目标 ${summaryNumber(
      request.design_targets.ultimate_pressure_min_MPa,
    )} MPa。端部边界：${
      boundaryLabels[request.boundary_conditions.type]
    }。\n\n` +
    table(
      [
        "编号",
        "候选角色",
        "材料",
        "L/mm",
        "内半径/mm",
        "总厚度/mm",
        "分析缺陷比",
        "单层厚度/mm",
        "角度序列对称",
        "正负角层数均衡",
        "40 层角度（外到内）",
        "历史参考与目标比较",
        "历史极限压力/MPa",
        "来源行",
      ],
      rows,
    ) +
    "\n\n### 材料输入\n\n" +
    table(
      [
        "材料",
        "密度/(kg/m^3)",
        "E1/GPa",
        "E2/GPa",
        "G12/GPa",
        "nu12",
        "Xt/MPa",
        "Xc/MPa",
        "Yt/MPa",
        "Yc/MPa",
        "S/MPa",
      ],
      materials.map((item) => fields.map((key) => item[key])),
    )
  );
}
