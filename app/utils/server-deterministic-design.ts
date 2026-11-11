type JsonScalar = string | number | boolean | null;

export type DeterministicDesignPayload = {
  schema_version: "1";
  candidate_count: number;
  layer_count: number;
  allowed_angles_deg: number[];
  excluded_angles_deg: number[];
  symmetric: boolean;
  balanced: boolean;
  materials: string[];
  ply_thickness_mm: number | null;
  parameter_values: Record<string, JsonScalar[]>;
};

export type DeterministicDesignIntent = {
  mode: "concept_layup_enumeration";
  candidateCount: number;
  latestUserText: string;
  facts: string[];
  assumptions: string[];
  payload: DeterministicDesignPayload;
};

export type FEMReadyDesignPayload = {
  schema_version: "2";
  generation_mode: "fem_ready_cylindrical_shell";
  candidate_count: number;
  geometry: {
    length_mm: number;
    radius_mm: number;
    thickness_mm?: number;
  };
  load_conditions: {
    service_depth_m?: number;
    external_pressure_MPa?: number;
    seawater_density_kg_per_m3?: number;
    gravity_m_per_s2?: number;
  };
  boundary_conditions?: {
    type: "END_CLAMPED" | "END_SIMPLY_SUPPORTED" | "FLANGE_CONSTRAINED";
  };
  materials?: string[];
  design_targets?: {
    safety_factor?: number;
    primary_objective?: string;
  };
  structure_form: string;
  manufacturing_process: string;
};

export type FEMReadyDesignIntent = {
  mode: "fem_ready_cylindrical_shell";
  candidateCount: number;
  latestUserText: string;
  facts: string[];
  assumptions: string[];
  payload: FEMReadyDesignPayload;
};

export type DesignIntent = DeterministicDesignIntent | FEMReadyDesignIntent;

type DesignCandidate = {
  candidate_id: number;
  material: string;
  parameters: Record<string, JsonScalar>;
  layup_deg: number[];
  layer_count: number;
  ply_thickness_mm: number | null;
  total_thickness_mm: number | null;
  symmetric: boolean;
  balanced: boolean;
};

export type DeterministicDesignServiceResponse = {
  status: "passed";
  generation_mode: "concept_layup_enumeration";
  engine_version: number;
  engine_fingerprint: string;
  result: {
    schema_version: "1";
    engine_version: number;
    engine_fingerprint: string;
    request: DeterministicDesignPayload & {
      non_neutral_angle_family_count?: number | null;
    };
    candidate_count: number;
    candidates: DesignCandidate[];
    design_fingerprint: string;
    evidence_boundary: string;
  };
  markdown: string;
};

type FEMReadyCandidate = {
  candidate_id: string;
  design_revision_id: string;
  hull_type: "CYLINDRICAL";
  geometry: {
    length_mm: number;
    radius_mm: number;
    thickness_mm: number;
    alpha_deg: number;
    beta_deg: number;
    imperfection_ratio: number;
  };
  layup: {
    ply_count: number;
    angles_deg: number[];
    ply_thickness_mm: number;
    balanced: boolean;
    symmetric: boolean;
  };
  material_system: Record<string, unknown>;
  load_conditions: { external_pressure_MPa: number };
  boundary_conditions: { type: string };
  design_targets: { ultimate_pressure_min_MPa: number };
  provenance: {
    source_sha256: string;
    source_row_number: number;
    geometry_match: string;
    historical_fem_reference: { status: string };
    source_laminate_stiffness_validation: {
      status: string;
      max_abs_error: number;
      absolute_tolerance: number;
    };
  };
  screening: {
    candidate_role:
      | "historically_screened_baseline"
      | "exact_geometry_exploration"
      | "nearest_neighbor_transfer_exploration";
  };
  fem_readiness: {
    current_fem_run_required: boolean;
    status: string;
  };
};

export type FEMReadyDesignServiceResponse = {
  status: "passed";
  contract_version: "1";
  generation_mode: "fem_ready_cylindrical_shell";
  result: {
    schema_version: "2";
    contract_version: "1";
    generation_mode: "fem_ready_cylindrical_shell";
    request: FEMReadyDesignPayload & {
      geometry: FEMReadyDesignPayload["geometry"] & {
        thickness_mm: number[] | null;
      };
      load_conditions: FEMReadyDesignPayload["load_conditions"] & {
        external_pressure_MPa: number;
      };
      materials: string[];
      design_targets: {
        ultimate_pressure_min_MPa: number;
        service_pressure_MPa: number;
        safety_factor: number | null;
        primary_objective: string;
      };
    };
    source_table: {
      sha256: string;
      row_count: number;
    };
    coverage: {
      exact_geometry_row_count: number;
      exact_geometry_reference_at_or_above_target_count: number;
      reference_result_status: string;
    };
    candidate_count: number;
    candidates: FEMReadyCandidate[];
    design_fingerprint: string;
    evidence_boundary: string;
  };
  markdown: string;
};

export type DesignServiceResponse =
  | DeterministicDesignServiceResponse
  | FEMReadyDesignServiceResponse;

const DEFAULT_LAYER_COUNT = 60;
const DEFAULT_ANGLES = [30, 45, 60, 90];
const DEFAULT_MATERIALS = [
  "高强碳纤维/环氧",
  "高模量碳纤维/环氧",
  "玻璃纤维/环氧",
];
const MAX_CANDIDATE_COUNT = 1000;
const MAX_FEM_CANDIDATE_COUNT = 60;
const DESIGN_REQUEST_TIMEOUT_MS = 30_000;
const FEM_TABLE_SHA256 =
  "04ba2a97d0979d270a21dff8b470fc6052ef5418208224cc3dcac3cd8e316c97";

function contentToText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "text"
        ? String((part as { text?: unknown }).text || "")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

function latestUserText(messages: unknown[]) {
  const message = messages.at(-1) as { role?: unknown; content?: unknown };
  return message?.role === "user" ? contentToText(message.content).trim() : "";
}

function parseChineseInteger(value: string) {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const character of value) {
    if (character in digits) {
      current = digits[character];
      continue;
    }
    const unit = units[character];
    if (!unit) return Number.NaN;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current;
}

function parsePositiveInteger(value: string) {
  const normalized = value.trim();
  const parsed = /^\d+$/.test(normalized)
    ? Number(normalized)
    : parseChineseInteger(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function extractCandidateCount(text: string) {
  const number = "(\\d{1,4}|[零〇一二两三四五六七八九十百千]+)";
  const chineseCandidateTail =
    "\\s*(?:组|个|套)\\s*[^。！？\\n]{0,96}?(?:初步|初始|候选|设计)?\\s*(?:方案|候选)";
  const patterns = [
    new RegExp(
      `(?:生成|给出|列出|提供|输出|设计|提出|构造|generate|create|provide|list)[^。！？\\n]{0,96}?${number}${chineseCandidateTail}`,
      "i",
    ),
    new RegExp(`${number}${chineseCandidateTail}`, "i"),
    new RegExp(`${number}\\s+(?:candidate\\s+)?designs?`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = parsePositiveInteger(match[1]);
    if (count && count <= MAX_CANDIDATE_COUNT) return count;
  }
  return null;
}

function extractLabeledNumber(text: string, labels: string, units: string) {
  const number = "(\\d+(?:\\.\\d+)?)";
  const before = text.match(
    new RegExp(
      `(?:${labels})\\s*(?:为|是|达到|约|=|:|：)?\\s*${number}\\s*(?:${units})`,
      "i",
    ),
  );
  if (before) return Number(before[1]);
  const after = text.match(
    new RegExp(`${number}\\s*(?:${units})\\s*(?:的)?\\s*(?:${labels})`, "i"),
  );
  return after ? Number(after[1]) : null;
}

function extractLengthMillimeters(text: string, labels: string) {
  const millimeters = extractLabeledNumber(text, labels, "mm|毫米");
  if (millimeters !== null) return millimeters;
  const meters = extractLabeledNumber(text, labels, "m(?!m)|米");
  return meters === null ? null : meters * 1000;
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function extractAngles(text: string) {
  const values = [...text.matchAll(/([+-]?\d+(?:\.\d+)?)\s*°/g)]
    .map((match) => Math.abs(Number(match[1])))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 90);
  return uniqueNumbers(values);
}

function extractExcludedAngles(text: string) {
  const values: number[] = [];
  for (const clause of text.split(/[。；;，,\n]/)) {
    if (!/(?:不采用|不使用|排除|禁止|不得使用|exclude)/i.test(clause)) {
      continue;
    }
    values.push(...extractAngles(clause));
  }
  return uniqueNumbers(values);
}

function extractMaterials(text: string) {
  const values = [
    ...text.matchAll(
      /\b(?:T\d+[A-Z0-9-]*|M\d+[A-Z0-9-]*|IM\d+[A-Z0-9-]*)\s*[\/／]\s*[A-Z0-9-]+\b/gi,
    ),
    ...text.matchAll(
      /(碳纤维|玻璃纤维|芳纶纤维|玄武岩纤维)\s*[\/／]\s*(环氧|乙烯基酯|聚酰亚胺)/g,
    ),
  ].map((match) => match[0].replace(/\s+/g, ""));
  return [...new Set(values)];
}

function extractFEMMaterials(text: string) {
  const aliases: Array<[RegExp, string]> = [
    [/T700\s*[\/／-]\s*(?:Epoxy|EP)\b/i, "T700/Epoxy"],
    [/T800G\s*[\/／-]\s*5228\b/i, "T800G/5228"],
    [/M40J\s*[\/／-]\s*TDE-?85\b/i, "M40J/TDE-85"],
    [/IM7\s*[\/／-]\s*8552\b/i, "IM7-8552"],
  ];
  return aliases
    .filter(([pattern]) => pattern.test(text))
    .map(([, material]) => material);
}

function extractExternalPressureMPa(text: string) {
  return extractLabeledNumber(
    text,
    "外压|外部压力|静水压力|设计压力|工作压力|external pressure|hydrostatic pressure",
    "MPa|兆帕",
  );
}

function extractSafetyFactor(text: string) {
  const match = text.match(
    /(?:安全系数|设计系数|safety\s*factor)\s*(?:为|是|=|:|：|取)?\s*(\d+(?:\.\d+)?)/i,
  );
  return match ? Number(match[1]) : null;
}

function extractBoundaryType(
  text: string,
): NonNullable<FEMReadyDesignPayload["boundary_conditions"]>["type"] | null {
  if (/(?:简支|simply\s*supported|SSSS)/i.test(text)) {
    return "END_SIMPLY_SUPPORTED";
  }
  if (/(?:固支|固定端|clamped|CCCC)/i.test(text)) {
    return "END_CLAMPED";
  }
  if (/(?:法兰|flange)/i.test(text)) return "FLANGE_CONSTRAINED";
  return null;
}

export function detectFEMReadyDesignIntent(
  messages: unknown[],
): FEMReadyDesignIntent | null {
  const text = latestUserText(messages);
  if (!text) return null;
  const count = extractCandidateCount(text);
  if (!count || count < 2) return null;
  if (
    !/(?:复合材料|层合|铺层|缠绕|composite|laminate|layup|winding)/i.test(
      text,
    ) ||
    !/(?:耐压壳|压力壳|圆柱壳|壳体|pressure\s+hull|cylindrical\s+shell)/i.test(
      text,
    ) ||
    !/(?:生成|给出|列出|提供|输出|设计|提出|构造|generate|create|provide|list)/i.test(
      text,
    )
  ) {
    return null;
  }

  const length = extractLengthMillimeters(
    text,
    "(?:圆柱壳|圆柱段|筒段|壳体)?长度",
  );
  const radius = extractLengthMillimeters(text, "内半径|内部半径");
  const depth = extractLabeledNumber(
    text,
    "水深|深度|下潜深度|工作深度|设计深度",
    "m(?!m)|米",
  );
  const externalPressure = extractExternalPressureMPa(text);
  if (
    length === null ||
    radius === null ||
    (depth === null && externalPressure === null)
  ) {
    return null;
  }

  const explicitLayerCount = extractLabeledNumber(
    text,
    "完整物理层数|总层数|铺层层数|层数",
    "层|plies?",
  );
  if (explicitLayerCount !== null && explicitLayerCount !== 40) {
    return null;
  }

  const totalThickness = extractLabeledNumber(
    text,
    "总厚度|壁厚|壳体厚度|total thickness",
    "mm|毫米",
  );
  const safetyFactor = extractSafetyFactor(text);
  const materials = extractFEMMaterials(text);
  const boundaryType = extractBoundaryType(text);
  const facts = [
    `圆柱段长度 ${length} mm`,
    `内半径 ${radius} mm`,
    depth !== null
      ? `工作水深 ${depth} m`
      : `外部静水压力 ${externalPressure} MPa`,
  ];
  if (totalThickness !== null) facts.push(`总厚度 ${totalThickness} mm`);
  if (materials.length) facts.push(`材料限定 ${materials.join("、")}`);
  if (safetyFactor !== null) facts.push(`安全系数 ${safetyFactor}`);
  if (boundaryType !== null) facts.push(`端部边界 ${boundaryType}`);
  if (explicitLayerCount !== null)
    facts.push(`完整物理层数 ${explicitLayerCount}`);
  if (/金属封头/.test(text)) {
    facts.push("结构形式为两端金属封头与中间复合材料圆柱壳");
  }

  const assumptions = [
    "候选来自正式有限元表格参数域，表中历史结果只用于筛选参考，所有候选必须由当前 Abaqus 模型重新求解。",
    "当前计算合同只覆盖复合材料圆柱壳子模型；金属封头、法兰和连接细节未显式建模。",
    "40 层顺序来自源表铺层模板，单层厚度由源行总厚度除以 40 得到，不是用户给定层厚。",
  ];
  if (boundaryType === null) {
    assumptions.push(
      "端部边界未指定，圆柱壳子模型采用端部法兰等效约束，属于待确认的建模假设。",
    );
  }
  if (safetyFactor === null) {
    assumptions.push(
      "安全系数未给定，极限压力最低目标暂按服务外压设置，不能据此声明整机安全。 ",
    );
  }
  if (!materials.length) {
    assumptions.push("材料未限定，候选在真实表格的四种材料体系内筛选。 ");
  }

  const payload: FEMReadyDesignPayload = {
    schema_version: "2",
    generation_mode: "fem_ready_cylindrical_shell",
    candidate_count: count,
    geometry: {
      length_mm: length,
      radius_mm: radius,
      ...(totalThickness !== null ? { thickness_mm: totalThickness } : {}),
    },
    load_conditions: {
      ...(depth !== null ? { service_depth_m: depth } : {}),
      ...(externalPressure !== null
        ? { external_pressure_MPa: externalPressure }
        : {}),
    },
    ...(boundaryType !== null
      ? { boundary_conditions: { type: boundaryType } }
      : {}),
    ...(materials.length ? { materials } : {}),
    ...(safetyFactor !== null
      ? { design_targets: { safety_factor: safetyFactor } }
      : {}),
    structure_form: /金属封头/.test(text)
      ? "两端金属封头、中间复合材料圆柱壳"
      : "复合材料圆柱壳",
    manufacturing_process: /缠绕/.test(text) ? "纤维缠绕" : "待确认",
  };

  return {
    mode: "fem_ready_cylindrical_shell",
    candidateCount: count,
    latestUserText: text,
    facts,
    assumptions,
    payload,
  };
}

function explicitBoolean(
  text: string,
  positivePattern: RegExp,
  negativePattern: RegExp,
) {
  if (negativePattern.test(text)) return false;
  if (positivePattern.test(text)) return true;
  return null;
}

export function detectDeterministicDesignIntent(
  messages: unknown[],
): DeterministicDesignIntent | null {
  const text = latestUserText(messages);
  if (!text) return null;
  const count = extractCandidateCount(text);
  if (!count || count < 2) return null;
  if (
    !/(?:复合材料|层合|铺层|缠绕|composite|laminate|layup|winding)/i.test(
      text,
    ) ||
    !/(?:耐压壳|压力壳|压力容器|圆柱壳|壳体|储氢瓶|COPV|pressure\s+(?:hull|vessel)|cylinder)/i.test(
      text,
    ) ||
    !/(?:生成|给出|列出|提供|输出|设计|提出|构造|generate|create|provide|list)/i.test(
      text,
    )
  ) {
    return null;
  }

  const facts: string[] = [];
  const assumptions: string[] = [];
  const parameterValues: Record<string, JsonScalar[]> = {};
  const depth = extractLabeledNumber(
    text,
    "水深|深度|下潜深度|工作深度",
    "m(?!m)|米",
  );
  if (depth !== null) {
    parameterValues.service_depth_m = [depth];
    facts.push(`工作水深 ${depth} m`);
  }
  const innerRadius = extractLengthMillimeters(text, "内半径|内部半径");
  if (innerRadius !== null) {
    parameterValues.inner_radius_mm = [innerRadius];
    facts.push(`内半径 ${innerRadius} mm`);
  }
  const length = extractLengthMillimeters(
    text,
    "(?:圆柱壳|圆柱段|筒段|壳体)?长度",
  );
  if (length !== null) {
    parameterValues.length_mm = [length];
    facts.push(`圆柱段长度 ${length} mm`);
  }
  if (/金属封头/.test(text) && /(?:圆柱壳|圆柱段|筒段)/.test(text)) {
    parameterValues.structure_form = ["两端金属封头+复合材料圆柱壳"];
    facts.push("结构形式为两端金属封头与中间复合材料圆柱壳");
  }
  if (/(?:纤维)?缠绕(?:工艺)?/.test(text)) {
    parameterValues.manufacturing_process = ["纤维缠绕"];
    facts.push("制造工艺为纤维缠绕");
  }

  const explicitLayerCount = extractLabeledNumber(
    text,
    "完整物理层数|总层数|铺层层数|层数",
    "层|plies?",
  );
  const layerCount = explicitLayerCount || DEFAULT_LAYER_COUNT;
  if (explicitLayerCount) {
    facts.push(`完整物理层数 ${explicitLayerCount} 层`);
  } else {
    assumptions.push(
      `完整物理层数未给定，初始筛选候选统一采用 ${DEFAULT_LAYER_COUNT} 层；该值不是安全性结论。`,
    );
  }

  const plyThickness = extractLabeledNumber(
    text,
    "单层厚度|单层名义厚度|ply thickness",
    "mm|毫米",
  );
  if (plyThickness !== null) {
    facts.push(`单层厚度 ${plyThickness} mm`);
  } else {
    assumptions.push(
      "单层厚度未给定，候选表保持“未给定/待确定”，不编造单层厚度和数值总厚度。",
    );
  }
  const totalThickness = extractLabeledNumber(
    text,
    "总厚度|壁厚|壳体厚度|total thickness",
    "mm|毫米",
  );
  if (totalThickness !== null) {
    parameterValues.total_thickness_mm = [totalThickness];
    facts.push(`总厚度 ${totalThickness} mm`);
  }

  const excludedAngles = extractExcludedAngles(text);
  const statedAngles = extractAngles(text).filter(
    (value) => !excludedAngles.includes(value),
  );
  const allowedAngles = statedAngles.length ? statedAngles : DEFAULT_ANGLES;
  if (!statedAngles.length) {
    assumptions.push(
      "允许角度未给定，初始筛选空间采用 30°、45°、60° 和 90°，并排除 0°。",
    );
  } else {
    facts.push(`允许角度族 ${allowedAngles.join("°、")}°`);
  }
  const normalizedExcludedAngles = excludedAngles.length
    ? excludedAngles
    : allowedAngles.includes(0)
    ? []
    : [0];

  const materials = extractMaterials(text);
  const selectedMaterials = materials.length ? materials : DEFAULT_MATERIALS;
  if (materials.length) {
    facts.push(`材料候选 ${materials.join("、")}`);
  } else {
    assumptions.push(
      `材料牌号未给定，候选空间仅用材料类别占位：${DEFAULT_MATERIALS.join(
        "、",
      )}；材料许用值仍需单独提供。`,
    );
  }

  const symmetricSetting = explicitBoolean(
    text,
    /(?:要求|采用|保持)?对称(?:铺层|层合)?/,
    /(?:不要求|无需|不采用|禁止)对称(?:铺层|层合)?|(?:采用|允许)非对称(?:铺层|层合)/,
  );
  const balancedSetting = explicitBoolean(
    text,
    /(?:要求|采用|保持)?均衡(?:铺层|层合)?/,
    /(?:不要求|无需|不采用|禁止)均衡(?:铺层|层合)?|(?:采用|允许)非均衡(?:铺层|层合)/,
  );
  const symmetric = symmetricSetting ?? true;
  const balanced = balancedSetting ?? true;
  if (symmetricSetting === null) {
    assumptions.push("为抑制拉伸-弯曲耦合，初始候选要求关于中面对称。");
  }
  if (balancedSetting === null) {
    assumptions.push("为控制面内剪切耦合，初始候选要求正负角层数均衡。");
  }

  return {
    mode: "concept_layup_enumeration",
    candidateCount: count,
    latestUserText: text,
    facts,
    assumptions,
    payload: {
      schema_version: "1",
      candidate_count: count,
      layer_count: layerCount,
      allowed_angles_deg: allowedAngles,
      excluded_angles_deg: normalizedExcludedAngles,
      symmetric,
      balanced,
      materials: selectedMaterials,
      ply_thickness_mm: plyThickness,
      parameter_values: parameterValues,
    },
  };
}

function sequenceIsSymmetric(sequence: number[]) {
  return sequence.every(
    (value, index) =>
      Math.abs(value - sequence[sequence.length - index - 1]) <= 1e-9,
  );
}

function sequenceIsBalanced(sequence: number[]) {
  const counts = new Map<number, number>();
  for (const value of sequence) {
    if (Math.abs(value) === 0 || Math.abs(value) === 90) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...new Set([...counts.keys()].map(Math.abs))].every(
    (magnitude) =>
      (counts.get(magnitude) || 0) === (counts.get(-magnitude) || 0),
  );
}

export function validateDeterministicDesignResponse(
  response: unknown,
  intent: DeterministicDesignIntent,
): asserts response is DeterministicDesignServiceResponse {
  const value = response as Partial<DeterministicDesignServiceResponse>;
  const candidates = value?.result?.candidates;
  const request = value?.result?.request;
  if (
    value?.status !== "passed" ||
    value.generation_mode !== "concept_layup_enumeration" ||
    !Number.isInteger(value.engine_version) ||
    !value.engine_fingerprint ||
    value.result?.engine_version !== value.engine_version ||
    value.result?.engine_fingerprint !== value.engine_fingerprint ||
    !value.result?.design_fingerprint ||
    value.result?.schema_version !== "1" ||
    !request ||
    request.schema_version !== intent.payload.schema_version ||
    request.candidate_count !== intent.payload.candidate_count ||
    request.layer_count !== intent.payload.layer_count ||
    JSON.stringify(request.allowed_angles_deg) !==
      JSON.stringify(intent.payload.allowed_angles_deg) ||
    JSON.stringify(request.excluded_angles_deg) !==
      JSON.stringify(intent.payload.excluded_angles_deg) ||
    request.symmetric !== intent.payload.symmetric ||
    request.balanced !== intent.payload.balanced ||
    JSON.stringify(request.materials) !==
      JSON.stringify(intent.payload.materials) ||
    request.ply_thickness_mm !== intent.payload.ply_thickness_mm ||
    JSON.stringify(request.parameter_values) !==
      JSON.stringify(intent.payload.parameter_values) ||
    value.result.candidate_count !== intent.candidateCount ||
    !Array.isArray(candidates) ||
    candidates.length !== intent.candidateCount ||
    typeof value.markdown !== "string"
  ) {
    throw new Error("确定性设计服务返回的数量、版本或结果结构无效。");
  }

  const uniqueSequences = new Set<string>();
  const allowedAngles = new Set(intent.payload.allowed_angles_deg);
  const excludedAngles = new Set(intent.payload.excluded_angles_deg);
  const parameterNames = Object.keys(intent.payload.parameter_values).sort();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (
      candidate.candidate_id !== index + 1 ||
      !Array.isArray(candidate.layup_deg) ||
      candidate.layup_deg.some(
        (angle) => typeof angle !== "number" || !Number.isFinite(angle),
      ) ||
      candidate.layup_deg.length !== intent.payload.layer_count ||
      candidate.layer_count !== intent.payload.layer_count ||
      candidate.material !==
        intent.payload.materials[index % intent.payload.materials.length]
    ) {
      throw new Error("确定性设计服务返回的编号、材料或物理层数无效。");
    }
    if (
      candidate.layup_deg.some(
        (angle) =>
          !allowedAngles.has(Math.abs(angle)) ||
          excludedAngles.has(Math.abs(angle)),
      )
    ) {
      throw new Error("确定性设计服务返回了允许集合外或已排除的角度。");
    }
    const candidateParameterNames = Object.keys(
      candidate.parameters || {},
    ).sort();
    if (
      JSON.stringify(candidateParameterNames) !==
        JSON.stringify(parameterNames) ||
      parameterNames.some(
        (name) =>
          !intent.payload.parameter_values[name].some(
            (value) => value === candidate.parameters[name],
          ),
      )
    ) {
      throw new Error("确定性设计服务返回的参数不在任务规格中。");
    }
    const sequenceKey = JSON.stringify(candidate.layup_deg);
    if (uniqueSequences.has(sequenceKey)) {
      throw new Error("确定性设计服务返回了重复铺层序列。");
    }
    uniqueSequences.add(sequenceKey);
    if (
      intent.payload.symmetric &&
      (!candidate.symmetric || !sequenceIsSymmetric(candidate.layup_deg))
    ) {
      throw new Error("确定性设计服务返回了不满足对称约束的铺层。");
    }
    if (
      intent.payload.balanced &&
      (!candidate.balanced || !sequenceIsBalanced(candidate.layup_deg))
    ) {
      throw new Error("确定性设计服务返回了不满足均衡约束的铺层。");
    }
    const explicitTotal = candidate.parameters.total_thickness_mm;
    const expectedTotal =
      typeof explicitTotal === "number"
        ? explicitTotal
        : intent.payload.ply_thickness_mm === null
        ? null
        : intent.payload.layer_count * intent.payload.ply_thickness_mm;
    if (
      candidate.ply_thickness_mm !== intent.payload.ply_thickness_mm ||
      (expectedTotal === null
        ? candidate.total_thickness_mm !== null
        : typeof candidate.total_thickness_mm !== "number" ||
          Math.abs(candidate.total_thickness_mm - expectedTotal) > 1e-9)
    ) {
      throw new Error("确定性设计服务返回的厚度边界或厚度算术无效。");
    }
  }
  const markdownRows = value.markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\d+\s*\|/.test(line));
  const markdownIds = markdownRows.map((line) =>
    Number(line.match(/^\|\s*(\d+)\s*\|/)?.[1]),
  );
  if (
    markdownRows.length !== intent.candidateCount ||
    markdownIds.some((candidateId, index) => candidateId !== index + 1)
  ) {
    throw new Error("确定性设计表的候选行数或编号不完整。");
  }
  if (/±|[₀-₉]|\]\s*[sS]\b/.test(markdownRows.join("\n"))) {
    throw new Error("确定性设计表包含压缩铺层记号。");
  }
}

export function validateFEMReadyDesignResponse(
  response: unknown,
  intent: FEMReadyDesignIntent,
): asserts response is FEMReadyDesignServiceResponse {
  const value = response as Partial<FEMReadyDesignServiceResponse>;
  const result = value.result;
  const candidates = result?.candidates;
  const request = result?.request;
  if (
    value.status !== "passed" ||
    value.contract_version !== "1" ||
    value.generation_mode !== "fem_ready_cylindrical_shell" ||
    result?.schema_version !== "2" ||
    result.contract_version !== "1" ||
    result.generation_mode !== intent.payload.generation_mode ||
    !request ||
    request.schema_version !== "2" ||
    request.generation_mode !== intent.payload.generation_mode ||
    request.candidate_count !== intent.candidateCount ||
    request.geometry.length_mm !== intent.payload.geometry.length_mm ||
    request.geometry.radius_mm !== intent.payload.geometry.radius_mm ||
    result.source_table?.sha256 !== FEM_TABLE_SHA256 ||
    result.source_table?.row_count !== 5857 ||
    result.candidate_count !== intent.candidateCount ||
    !Array.isArray(candidates) ||
    candidates.length !== intent.candidateCount ||
    !result.design_fingerprint ||
    typeof value.markdown !== "string"
  ) {
    throw new Error("FEM-ready 设计服务返回的版本、数据源或结果结构无效。");
  }
  if (
    intent.payload.load_conditions.service_depth_m !== undefined &&
    request.load_conditions.service_depth_m !==
      intent.payload.load_conditions.service_depth_m
  ) {
    throw new Error("FEM-ready 设计服务返回的工作水深与请求不一致。");
  }
  if (
    intent.payload.load_conditions.external_pressure_MPa !== undefined &&
    request.load_conditions.external_pressure_MPa !==
      intent.payload.load_conditions.external_pressure_MPa
  ) {
    throw new Error("FEM-ready 设计服务返回的外压与请求不一致。");
  }
  if (
    typeof request.load_conditions.external_pressure_MPa !== "number" ||
    request.load_conditions.external_pressure_MPa <= 0
  ) {
    throw new Error("FEM-ready 设计服务未返回有效外部静水压力。");
  }

  const revisions = new Set<string>();
  const requiredMaterialFields = [
    "name",
    "material_key",
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
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (
      candidate.candidate_id !== `TMP_${index + 1}` ||
      candidate.hull_type !== "CYLINDRICAL" ||
      candidate.geometry.length_mm !== intent.payload.geometry.length_mm ||
      candidate.geometry.radius_mm !== intent.payload.geometry.radius_mm ||
      !Number.isFinite(candidate.geometry.thickness_mm) ||
      candidate.geometry.thickness_mm <= 0 ||
      !Number.isFinite(candidate.geometry.imperfection_ratio) ||
      candidate.geometry.imperfection_ratio <= 0 ||
      candidate.layup.ply_count !== 40 ||
      !Array.isArray(candidate.layup.angles_deg) ||
      candidate.layup.angles_deg.length !== 40 ||
      candidate.layup.angles_deg.some(
        (angle) => !Number.isFinite(angle) || Math.abs(angle) > 90,
      ) ||
      candidate.layup.balanced !== true ||
      !sequenceIsBalanced(candidate.layup.angles_deg) ||
      candidate.layup.symmetric !==
        sequenceIsSymmetric(candidate.layup.angles_deg) ||
      !Number.isFinite(candidate.layup.ply_thickness_mm) ||
      candidate.layup.ply_thickness_mm <= 0 ||
      Math.abs(
        candidate.layup.ply_thickness_mm * candidate.layup.ply_count -
          candidate.geometry.thickness_mm,
      ) > 1e-5 ||
      candidate.load_conditions.external_pressure_MPa !==
        request.load_conditions.external_pressure_MPa ||
      !candidate.boundary_conditions.type ||
      !Number.isFinite(candidate.design_targets.ultimate_pressure_min_MPa) ||
      candidate.design_targets.ultimate_pressure_min_MPa <= 0 ||
      candidate.provenance.source_sha256 !== FEM_TABLE_SHA256 ||
      ![
        "historically_screened_baseline",
        "exact_geometry_exploration",
        "nearest_neighbor_transfer_exploration",
      ].includes(candidate.screening?.candidate_role) ||
      candidate.provenance.historical_fem_reference.status !==
        "screening_reference_only_not_current_run" ||
      candidate.provenance.source_laminate_stiffness_validation.status !==
        "recomputed_from_explicit_sequence" ||
      !Number.isFinite(
        candidate.provenance.source_laminate_stiffness_validation.max_abs_error,
      ) ||
      candidate.provenance.source_laminate_stiffness_validation.max_abs_error >
        candidate.provenance.source_laminate_stiffness_validation
          .absolute_tolerance ||
      candidate.fem_readiness.current_fem_run_required !== true ||
      !/^DR_[a-f0-9]{64}$/.test(candidate.design_revision_id) ||
      requiredMaterialFields.some((field) => {
        const materialValue = candidate.material_system[field];
        if (field === "name" || field === "material_key") {
          return typeof materialValue !== "string" || !materialValue.trim();
        }
        return (
          typeof materialValue !== "number" ||
          !Number.isFinite(materialValue) ||
          materialValue <= 0
        );
      })
    ) {
      throw new Error(
        `FEM-ready 候选 ${index + 1} 缺少当前圆柱壳校核所需输入。`,
      );
    }
    if (revisions.has(candidate.design_revision_id)) {
      throw new Error("FEM-ready 设计服务返回了重复设计修订。");
    }
    revisions.add(candidate.design_revision_id);
  }

  const markdownRows = value.markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*TMP_\d+\s*\|/.test(line));
  if (
    markdownRows.length !== intent.candidateCount ||
    markdownRows.some(
      (line, index) =>
        line.match(/^\|\s*(TMP_\d+)\s*\|/)?.[1] !== `TMP_${index + 1}`,
    )
  ) {
    throw new Error("FEM-ready 候选表的行数或编号不完整。");
  }
  if (/±|[₀-₉]|\]\s*[sS]\b/.test(markdownRows.join("\n"))) {
    throw new Error("FEM-ready 候选表包含压缩铺层记号。");
  }
}

export async function requestDeterministicDesign(
  intent: DesignIntent,
  options: { baseUrl: string; apiKey?: string },
): Promise<DesignServiceResponse> {
  if (
    intent.mode === "fem_ready_cylindrical_shell" &&
    intent.candidateCount > MAX_FEM_CANDIDATE_COUNT
  ) {
    throw new Error(
      `FEM-ready 圆柱壳候选一次最多生成 ${MAX_FEM_CANDIDATE_COUNT} 组。`,
    );
  }
  const configuredBaseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!configuredBaseUrl) throw new Error("CS2 确定性设计服务地址未配置。");
  const baseUrl = configuredBaseUrl.endsWith("/v1")
    ? configuredBaseUrl
    : `${configuredBaseUrl}/v1`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DESIGN_REQUEST_TIMEOUT_MS,
  );
  try {
    const endpoint =
      intent.mode === "fem_ready_cylindrical_shell"
        ? "fem-candidates"
        : "candidates";
    const response = await fetch(`${baseUrl}/design/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.apiKey
          ? { Authorization: `Bearer ${options.apiKey}` }
          : {}),
      },
      body: JSON.stringify(intent.payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `确定性设计服务返回了非 JSON 响应（HTTP ${response.status}）。`,
      );
    }
    if (!response.ok) {
      const detail =
        data && typeof data === "object" && "detail" in data
          ? String((data as { detail?: unknown }).detail || "")
          : "";
      throw new Error(
        `确定性设计服务拒绝了当前任务（HTTP ${response.status}）${
          detail ? `：${detail}` : ""
        }。`,
      );
    }
    if (intent.mode === "fem_ready_cylindrical_shell") {
      validateFEMReadyDesignResponse(data, intent);
    } else {
      validateDeterministicDesignResponse(data, intent);
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("确定性设计服务请求超时，未返回不完整候选。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildDesignNarrativeInstruction(
  intent: DesignIntent,
  response: DesignServiceResponse,
) {
  if (
    intent.mode === "fem_ready_cylindrical_shell" &&
    response.generation_mode === "fem_ready_cylindrical_shell"
  ) {
    const request = response.result.request;
    const coverage = response.result.coverage;
    const roleCounts = response.result.candidates.reduce(
      (counts, candidate) => {
        counts[candidate.screening.candidate_role] += 1;
        return counts;
      },
      {
        historically_screened_baseline: 0,
        exact_geometry_exploration: 0,
        nearest_neighbor_transfer_exploration: 0,
      },
    );
    return `当前请求由 CSGPT 工程设计路径处理。结构化引擎已从指纹固定的真实有限元表格中生成并校验 ${
      intent.candidateCount
    } 组可进入 CSDM_cph 圆柱壳子模型的候选。你只负责工程解释，不得重新枚举、删改或补写候选。

请用简体中文写四个简洁但完整的小节：
1. “任务与 FEM 输入”：说明圆柱段几何、服务外压 ${
      request.load_conditions.external_pressure_MPa
    } MPa、边界条件、材料范围、40 层显式铺层、总厚度和初始缺陷均已进入结构化候选。材料范围严格为 ${request.materials.join(
      "、",
    )}，不得补入其他材料体系；材料名称不证明材料常数的试验来源。40 层来自源表模板，不得把模型或源表默认值说成用户输入；形成输入包不表示已导入 CSDM_cph 或运行有限元。
2. “候选来源与筛选”：说明正式表格共 ${
      response.result.source_table.row_count
    } 行；目标几何有 ${coverage.exact_geometry_row_count} 行，其中 ${
      coverage.exact_geometry_reference_at_or_above_target_count
    } 行历史参考极限压力不低于当前目标。实际选中的候选角色为：同几何历史基线 ${
      roleCounts.historically_screened_baseline
    } 组，同几何探索 ${
      roleCounts.exact_geometry_exploration
    } 组，最近邻迁移探索 ${
      roleCounts.nearest_neighbor_transfer_exploration
    } 组。三者分别说明，不得把同几何探索写成几何迁移。历史值只用于筛选，不是当前 Abaqus 结果；只有最近邻迁移探索固定为用户几何后需要重新评估来源几何差异。
3. “数据流”：说明每个候选包含稳定 design_revision_id、几何、40 个逐层角度、材料属性、缺陷、载荷、边界和目标，可作为 CSDM_cph 当前圆柱壳校核的输入；有限元结果必须按 design_revision_id 回写。
4. “适用边界”：明确当前只建模复合材料圆柱壳，未显式建模金属封头、法兰和连接；未完成当前 Abaqus 求解、网格收敛、缺陷敏感性、渐进损伤、制造偏差和试验验证前，不得宣称整机在目标水深安全。

层合板术语边界：均衡表示非 0°/90° 角度的正负层数相等，主要约束经典层合理论中的面内拉伸-剪切耦合项 A16/A26；均衡不等于关于中面对称。只有逐层关于中面的镜像对称才支持 B 矩阵为零的对称结论。对非对称但均衡的候选，不得声称 B=0 或没有拉伸-弯曲耦合；应引用候选实际的 symmetric 和 balanced 字段，并说明仍需当前 Abaqus 校核。

对于“非对称但均衡”的候选，解释必须按以下三个可核验事实组织，不能改写成相反关系：
- 均衡：正负角层数相等，主要说明 A16/A26 等面内拉伸-剪切耦合项的消除趋势；均衡本身不决定 B 矩阵。
- 对称：物理层序列关于中面对称时，才可在相同材料和厚度假设下说明 B=0；对称性与均衡性是两个独立字段。
- 当前候选若为 symmetric=false 且 balanced=true：只能说明“非对称但均衡，不能由该字段推出 B=0，仍需按 design_revision_id 运行当前 Abaqus 校核”，不得同时出现“该候选 B_ij=0”“均衡导致 B=0”或“无拉伸-弯曲耦合”。

禁止重新输出候选表，禁止把历史参考值写成当前计算值，禁止编造安全系数、整机承载能力或 Abaqus 结果。说明控制在 1400 个汉字以内，最后一句写“完整 FEM 输入候选表如下”。

用户明确输入：
${intent.facts.map((item) => `- ${item}`).join("\n")}

建模与证据边界：
${intent.assumptions.map((item) => `- ${item.trim()}`).join("\n")}`;
  }

  if (
    intent.mode !== "concept_layup_enumeration" ||
    response.generation_mode === "fem_ready_cylindrical_shell"
  ) {
    throw new Error("设计意图与设计服务响应模式不一致。");
  }
  return `当前请求由 CSGPT 组合生产路径处理。确定性设计引擎已经生成并校验 ${
    intent.candidateCount
  } 组候选，设计引擎版本为 ${
    response.engine_version
  }。你只负责工程解释，不负责重新枚举候选。

请用简体中文写四个简洁但完整的小节：
1. “需求与已知输入”：只复述用户明确给定的事实。
2. “候选空间假设”：逐项说明下面的初始筛选假设，并明确它们不是安全结论。
3. “生成与独立复核方法”：解释精确数量、编号、逐个物理层展开、唯一性、角度集合、层数、厚度边界、对称和均衡是如何由确定性引擎生成并复核的。
4. “安全性边界与后续校核”：说明这些是待校核候选，不能据此宣称可在目标工况安全使用；列出静水外压换算、材料许用值、金属封头与复合材料连接、初始缺陷、几何非线性、屈曲/塌陷、渐进损伤、网格收敛、制造与试验验证等必要工作。

禁止重新输出候选表、禁止使用 ±、尾部 s、下标或重复次数压缩铺层、禁止编造单层厚度、总厚度、承载值、安全系数或有限元结果。说明控制在 1200 个汉字以内，最后一句写“完整候选表如下”。

用户明确输入：
${
  intent.facts.length
    ? intent.facts.map((item) => `- ${item}`).join("\n")
    : "- 未提取到可直接采用的数值事实"
}

初始筛选假设：
${intent.assumptions.map((item) => `- ${item}`).join("\n")}`;
}

function localizeParameterHeaders(markdown: string) {
  const replacements: Record<string, string> = {
    inner_radius_mm: "内半径/mm",
    length_mm: "圆柱段长度/mm",
    manufacturing_process: "制造工艺",
    service_depth_m: "工作水深/m",
    structure_form: "结构形式",
    total_thickness_mm: "输入总厚度/mm",
  };
  return Object.entries(replacements).reduce(
    (text, [source, target]) => text.replaceAll(source, target),
    markdown,
  );
}

export function renderDeterministicDesignAppendix(
  intent: DesignIntent,
  response: DesignServiceResponse,
) {
  if (
    intent.mode === "fem_ready_cylindrical_shell" &&
    response.generation_mode === "fem_ready_cylindrical_shell"
  ) {
    return `\n\n## FEM-ready 圆柱壳候选

以下 ${intent.candidateCount} 组候选来自指纹固定的真实有限元表格参数域，包含 CSDM_cph 当前圆柱壳子模型所需的几何、材料、40 层显式铺层、初始缺陷、载荷、边界和目标字段。历史有限元值只用于来源筛选，所有候选仍需按 design_revision_id 重新运行当前 Abaqus 模型；本表不代表金属封头与连接结构已经校核。

${response.markdown}`;
  }
  if (
    intent.mode !== "concept_layup_enumeration" ||
    response.generation_mode === "fem_ready_cylindrical_shell"
  ) {
    throw new Error("设计意图与设计服务响应模式不一致。");
  }
  return `\n\n## 确定性候选表\n\n以下 ${
    intent.candidateCount
  } 组方案由确定性设计引擎逐项生成并通过硬约束复核。表中的铺层均按从外表面到内表面的物理层逐层展开；“未给定”和“待确定”表示输入缺失，不代表零值。\n\n${localizeParameterHeaders(
    response.markdown,
  )}\n\n设计结果指纹：\`${
    response.result.design_fingerprint
  }\`；设计引擎版本：\`${response.engine_version}\`。`;
}
