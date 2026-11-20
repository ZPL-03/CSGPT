import {
  renderDesignTable,
  stableJson,
  validateDesignContract,
  validateDesignInterpretationContext,
  type DesignServiceResponse,
  type DeterministicDesignServiceResponse,
  type FEMReadyDesignServiceResponse,
} from "./design-contract";
import { DESIGN_FACT_RULES } from "./design-context";
import { designNarrativeTask } from "./design-narrative";
export type {
  DesignServiceResponse,
  DeterministicDesignServiceResponse,
  FEMReadyDesignServiceResponse,
} from "./design-contract";

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
    imperfection_ratio?: number;
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
      `(?:生成|枚举|给出|列出|提供|输出|设计|提出|构造|generate|enumerat|create|provide|list)[^。！？\\n]{0,96}?${number}${chineseCandidateTail}`,
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

function hasCandidateGenerationRequest(text: string) {
  // 两种工具入口共用动作判断，设计名词和已有结果不构成生成请求。
  if (
    /(?:不要|无需|不必|禁止|停止|不需要|不再)\s*(?:再|重新)?\s*(?:生成|枚举|给出|列出|提供|输出|设计|提出|构造)/.test(
      text,
    ) ||
    /(?:do\s+not|don't|no\s+need\s+to)\s+(?:generate|enumerate|create|provide|list|design)\b/i.test(
      text,
    ) ||
    /(?:已有|已生成|已经生成|已枚举)\s*(?:的)?\s*(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:组|个|套)/.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /(?:生成|枚举|给出|列出|提供|输出|提出|构造|generate|enumerate|create|provide|list).{0,40}(?:\d+\s*(?:组|个|套)|候选|方案|designs?|candidates?)/i.test(
      text,
    ) ||
    /设计\s*(?:\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:组|个|套)|\bdesign\s+\d+\s+(?:candidate\s+)?designs?\b/i.test(
      text,
    )
  );
}

const NUMERIC_VALUE = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*/\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)?`;

function parseNumber(value: string, field = "数值约束") {
  const parts = value.split("/").map(Number);
  const result = parts.length === 2 ? parts[0] / parts[1] : parts[0];
  if (!Number.isFinite(result) || result <= 0)
    throw new Error(`${field}必须为有限正数。`);
  return result;
}

function singleValue(values: number[], field: string) {
  if (!values.length) return null;
  if (values.some((value) => Math.abs(value - values[0]) > 1e-9)) {
    throw new Error(`${field}指定了不同取值，请明确采用值。`);
  }
  return values[0];
}

function extractLabeledNumber(text: string, labels: string, units: string) {
  const number = `(${NUMERIC_VALUE})`;
  const unit = units
    ? `\\s*(?:${units})(?![A-Za-z0-9/])`
    : String.raw`(?=$|[^A-Za-z0-9./+%‰-])`;
  const before = new RegExp(
    `(?:${labels})\\s*(?:为|是|达到|约|取|=|:|：)?\\s*${number}${unit}`,
    "gi",
  );
  const values = [...text.matchAll(before)].map((match) =>
    parseNumber(match[1]),
  );
  if (units) {
    const after = new RegExp(
      `${number}\\s*(?:${units})\\s*(?:的)?\\s*(?:${labels})`,
      "gi",
    );
    values.push(
      ...[...text.matchAll(after)].map((match) => parseNumber(match[1])),
    );
  }
  return singleValue(values, "同一数值约束");
}

function extractLengthMillimeters(text: string, labels: string) {
  const millimeters = extractLabeledNumber(text, labels, "mm|毫米");
  const meters = extractLabeledNumber(text, labels, "m(?!m)|米");
  return singleValue(
    [
      ...(millimeters === null ? [] : [millimeters]),
      ...(meters === null ? [] : [meters * 1000]),
    ],
    "长度",
  );
}

// 否定作用于后续并列项，直到同一句中的肯定选择词改变作用范围。
function excludedAt(text: string, index: number) {
  const segments = (
    text
      .slice(0, index)
      .split(/[。；;\n]/)
      .at(-1) || ""
  ).split(/[，,]/);
  let clause = segments.pop() || "";
  while (segments.length && /^(?:\s|和|与|及|、|或|and|or)*$/i.test(clause)) {
    clause = segments.pop() + "," + clause;
  }
  const markers = [
    ...clause.matchAll(
      /((?:不(?:要|必|需|得)?|禁止|严禁|排除|不是|非)\s*(?:再)?\s*(?:采用|使用|选用|选择|选|要求|允许)?|\b(?:not|without|exclude)\b\s*(?:use|using|select|allow)?\s*)|(采用|使用|选用|选择|只允许|仅允许|允许|设为|而取|\buse\b|\binstead\b)/gi,
    ),
  ];
  return Boolean(markers.at(-1)?.[1]);
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function extractAngleConstraints(text: string) {
  const selected: number[] = [];
  const excluded: number[] = [];
  for (const match of text.matchAll(
    /([±+-]?\d+(?:\.\d+)?)\s*(?:°|度|\bdeg(?:rees?)?\b)/gi,
  )) {
    const value = Math.abs(Number(match[1].replace("±", "")));
    if (!Number.isFinite(value) || value > 90)
      throw new Error("候选角度族必须位于 0° 到 90°。");
    (excludedAt(text, match.index!) ? excluded : selected).push(value);
  }
  if (selected.some((value) => excluded.includes(value)))
    throw new Error("角度允许项与排除项冲突。");
  return {
    selected: uniqueNumbers(selected),
    excluded: uniqueNumbers(excluded),
  };
}

function extractMaterials(text: string, fem: boolean) {
  const aliases = new Map([
    ["T700/EPOXY", "T700/Epoxy"],
    ["T700/EP", "T700/Epoxy"],
    ["T700/环氧", "T700/Epoxy"],
    ["T800G/5228", "T800G/5228"],
    ["M40J/TDE85", "M40J/TDE-85"],
    ["IM7/8552", "IM7-8552"],
  ]);
  const tokens = [
    ...text.matchAll(
      /\b(?:T\d+[A-Z0-9]*|M\d+[A-Z0-9]*|IM\d+[A-Z0-9]*)(?:\s*[/／-]\s*(?:[A-Z0-9-]+|环氧|乙烯基酯|聚酰亚胺))?/gi,
    ),
    ...text.matchAll(
      /(?:高强|高模量)?(?:碳纤维|玻璃纤维|芳纶纤维|玄武岩纤维)\s*[/／]\s*(?:环氧|乙烯基酯|聚酰亚胺)/g,
    ),
  ];
  const selected = new Set<string>();
  const excluded = new Set<string>();
  for (const token of tokens) {
    const normalized = token[0]
      .replace(/\s+/g, "")
      .replace("／", "/")
      .toUpperCase()
      .replace(/^(IM\d+|T\d+[A-Z]*|M\d+[A-Z]*)-/, "$1/")
      .replace("TDE-85", "TDE85");
    const negative = excludedAt(text, token.index!);
    const material =
      aliases.get(normalized) ??
      token[0].replace(/\s+/g, "").replace("／", "/");
    if (fem && !negative && !aliases.has(normalized))
      throw new Error(`FEM-ready 源表不包含指定材料 ${token[0]}。`);
    (negative ? excluded : selected).add(material);
  }
  if ([...selected].some((name) => excluded.has(name)))
    throw new Error("材料允许项与排除项冲突。");
  // 材料声明必须落到已解析的牌号，不能把未识别的声明当作未指定。
  for (const mention of text.matchAll(
    /(?:只允许|仅允许|指定|限定)\s*材料|材料\s*(?:[:：=]|为|是|[A-Za-z0-9])|\bmaterials?\s*[:=]/gi,
  )) {
    const end = text.slice(mention.index!).search(/[，,。；;\n]/);
    const limit = end < 0 ? text.length : mention.index! + end;
    if (
      !tokens.some(
        (token) => token.index! >= mention.index! && token.index! < limit,
      )
    )
      throw new Error("无法识别指定材料，请提供材料牌号与基体名称。");
  }
  if (!tokens.length) return [];
  const materials = (
    selected.size
      ? [...selected]
      : fem
      ? [...new Set(aliases.values())]
      : DEFAULT_MATERIALS
  ).filter((name) => !excluded.has(name));
  if (!materials.length) throw new Error("材料约束没有可用候选。");
  return materials;
}

function extractExternalPressureMPa(text: string) {
  return extractLabeledNumber(
    text,
    "外压|外部压力|静水压力|设计压力|工作压力|external pressure|hydrostatic pressure",
    "MPa|兆帕",
  );
}

function extractSafetyFactor(text: string) {
  return extractLabeledNumber(text, "安全系数|设计系数|safety\\s*factor", "");
}

function extractImperfectionRatio(text: string) {
  const label = "(?:初始)?缺陷(?:比|幅值)|imperfection(?:_ratio|\\s+ratio)";
  const expression = new RegExp(
    `(?:${label})\\s*(?:为|是|=|:|：|取)?\\s*(千分之|百分之)?\\s*(${NUMERIC_VALUE}|[零〇一二两三四五六七八九十百千]+)\\s*(‰|%|％)?(?=\\s*(?:$|[，,。;；、\\n!！?？]|且|并|和|and\\b))`,
    "gi",
  );
  const matches = [...text.matchAll(expression)];
  const mentions = [...text.matchAll(new RegExp(label, "gi"))];
  if (matches.length !== mentions.length)
    throw new Error(
      "请用完整无量纲数值表示缺陷比，例如 0.008、2e-3、1/500 或 8‰；绝对缺陷幅值需要另给定义。",
    );
  if (!matches.length) return null;
  const values = matches.map((match) => {
    const raw = /^[+-]?[\d.]/.test(match[2])
      ? parseNumber(match[2], "分析缺陷比")
      : parseChineseInteger(match[2]);
    if (match[1] && match[3])
      throw new Error("缺陷比的百分比与千分比单位重复，请使用一种表示方式。");
    const divisor =
      match[1] === "千分之" || match[3] === "‰"
        ? 1000
        : match[1] === "百分之" || match[3] === "%" || match[3] === "％"
        ? 100
        : 1;
    const value = raw / divisor;
    if (!Number.isFinite(value) || value <= 0)
      throw new Error("分析缺陷比必须为正数。");
    return value;
  });
  if (values.some((value) => Math.abs(value - values[0]) > 1e-12))
    throw new Error("指定了多个不同的缺陷比，请明确采用值。");
  return values[0];
}

function extractBoundaryType(
  text: string,
): NonNullable<FEMReadyDesignPayload["boundary_conditions"]>["type"] | null {
  const definitions = [
    [/(?:简支|simply\s*supported|SSSS)/gi, "END_SIMPLY_SUPPORTED"],
    [/(?:固支|固定端|clamped|CCCC)/gi, "END_CLAMPED"],
    [
      /(?:法兰(?:等效)?约束|flange\s*(?:constrained|constraint))/gi,
      "FLANGE_CONSTRAINED",
    ],
  ] as const;
  const selected = new Set<
    NonNullable<FEMReadyDesignPayload["boundary_conditions"]>["type"]
  >();
  const excluded = new Set<string>();
  for (const [pattern, type] of definitions) {
    for (const match of text.matchAll(pattern)) {
      const negative = excludedAt(text, match.index!);
      if (negative) excluded.add(type);
      else selected.add(type);
    }
  }
  if (selected.size > 1 || [...selected].some((type) => excluded.has(type))) {
    throw new Error("端部边界条件存在冲突，请明确一种边界。");
  }
  if (!selected.size && excluded.size)
    throw new Error("请求只排除了边界类型，请明确采用的端部边界。");
  return [...selected][0] ?? null;
}

export function detectFEMReadyDesignIntent(
  messages: unknown[],
): FEMReadyDesignIntent | null {
  const text = latestUserText(messages);
  if (!text || !hasCandidateGenerationRequest(text)) return null;
  if (
    !/(?:FEM[-_ ]?ready|可直接进入有限元校核|(?:有限元|Abaqus).{0,8}(?:输入包|输入文件|候选包)|CSDM_cph)/i.test(
      text,
    )
  )
    return null;
  const count = extractCandidateCount(text);
  if (!count || count < 2) return null;
  if (
    !/(?:复合材料|层合|铺层|缠绕|composite|laminate|layup|winding)/i.test(
      text,
    ) ||
    !/(?:耐压壳|压力壳|圆柱壳|壳体|pressure\s+hull|cylindrical\s+shell)/i.test(
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
    throw new Error(
      "FEM-ready 候选需要明确的圆柱段长度、内半径以及水深或外压。",
    );
  }

  const explicitLayerCount = extractLabeledNumber(
    text,
    "完整物理层数|总层数|铺层层数|层数",
    "层|plies?",
  );
  if (explicitLayerCount !== null && explicitLayerCount !== 40) {
    throw new Error(
      "FEM-ready 源表候选采用 40 层铺层，指定层数与源表合同不一致。",
    );
  }

  let totalThickness = extractLabeledNumber(
    text,
    "总厚度|壁厚|壳体厚度|total thickness",
    "mm|毫米",
  );
  const plyThickness = extractLabeledNumber(
    text,
    "单层厚度|单层名义厚度|ply thickness",
    "mm|毫米",
  );
  if (plyThickness !== null) {
    const calculatedTotal = Number((plyThickness * 40).toFixed(6));
    if (
      totalThickness !== null &&
      Math.abs(totalThickness - calculatedTotal) > 1e-6
    ) {
      throw new Error("指定总厚度与 40 层单层厚度之和不一致。");
    }
    totalThickness = calculatedTotal;
  }
  const imperfection = extractImperfectionRatio(text);
  const safetyFactor = extractSafetyFactor(text);
  const materials = extractMaterials(text, true);
  const angleConstraints = extractAngleConstraints(text);
  if (angleConstraints.selected.length || angleConstraints.excluded.length)
    throw new Error(
      "FEM-ready 源表接口不支持角度筛选；限定角度的候选请使用概念铺层枚举。",
    );
  const boundaryType = extractBoundaryType(text);
  const facts = [
    `圆柱段长度 ${length} mm`,
    `内半径 ${radius} mm`,
    depth !== null
      ? `工作水深 ${depth} m`
      : `外部静水压力 ${externalPressure} MPa`,
  ];
  if (totalThickness !== null) facts.push(`总厚度 ${totalThickness} mm`);
  if (plyThickness !== null) facts.push(`单层厚度 ${plyThickness} mm`);
  if (imperfection !== null) facts.push(`分析缺陷比 ${imperfection}`);
  if (depth !== null && externalPressure !== null)
    facts.push(`外部静水压力 ${externalPressure} MPa`);
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
    "40 层顺序来自源表铺层模板，候选按等厚层输入。",
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
      ...(imperfection !== null ? { imperfection_ratio: imperfection } : {}),
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
  if (!text || !hasCandidateGenerationRequest(text)) return null;
  const count = extractCandidateCount(text);
  if (!count || count < 2) return null;
  if (
    !/(?:复合材料|层合|铺层|缠绕|composite|laminate|layup|winding)/i.test(
      text,
    ) ||
    !/(?:耐压壳|压力壳|压力容器|圆柱壳|壳体|储氢瓶|COPV|pressure\s+(?:hull|vessel)|cylinder)/i.test(
      text,
    )
  ) {
    return null;
  }

  const facts: string[] = [];
  const assumptions: string[] = [];
  const parameterValues: Record<string, JsonScalar[]> = {};
  const pressure = extractExternalPressureMPa(text);
  const safetyFactor = extractSafetyFactor(text);
  const imperfection = extractImperfectionRatio(text);
  if (pressure !== null) {
    parameterValues.design_pressure_mpa = [pressure];
    facts.push(`外压 ${pressure} MPa`);
  }
  if (safetyFactor !== null) {
    parameterValues.safety_factor = [safetyFactor];
    facts.push(`安全系数 ${safetyFactor}`);
  }
  if (imperfection !== null) {
    parameterValues.imperfection_ratio = [imperfection];
    facts.push(`分析缺陷比 ${imperfection}`);
  }
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
      `用户未指定物理层数；工具选择 ${DEFAULT_LAYER_COUNT} 层并生成每个候选的完整层序。`,
    );
  }

  const plyThickness = extractLabeledNumber(
    text,
    "单层厚度|单层名义厚度|ply thickness",
    "mm|毫米",
  );
  if (plyThickness !== null) {
    facts.push(`单层厚度 ${plyThickness} mm`);
  }
  const totalThickness = extractLabeledNumber(
    text,
    "总厚度|壁厚|壳体厚度|total thickness",
    "mm|毫米",
  );
  if (totalThickness !== null) {
    if (
      plyThickness !== null &&
      Math.abs(totalThickness - layerCount * plyThickness) > 1e-6
    ) {
      throw new Error("指定总厚度与物理层数、单层厚度不一致。");
    }
    parameterValues.total_thickness_mm = [totalThickness];
    facts.push(`总厚度 ${totalThickness} mm`);
  }
  if (plyThickness === null) {
    assumptions.push(
      totalThickness === null
        ? "单层厚度和总厚度未给定，厚度字段保留为空。"
        : "总厚度按输入保存；总厚度除以层数给出平均层厚，实际各层厚度待材料与工艺确定。",
    );
  }

  const { selected: statedAngles, excluded: excludedAngles } =
    extractAngleConstraints(text);
  const allowedAngles = (
    statedAngles.length ? statedAngles : DEFAULT_ANGLES
  ).filter((value) => !excludedAngles.includes(value));
  if (!allowedAngles.length)
    throw new Error("角度约束没有可用候选，请明确允许的角度族。");
  if (!statedAngles.length) {
    assumptions.push(
      `允许角度未给定，筛选空间采用 ${allowedAngles.join("°、")}°。`,
    );
  } else {
    facts.push(`允许角度族 ${allowedAngles.join("°、")}°`);
  }
  const normalizedExcludedAngles = excludedAngles.length
    ? excludedAngles
    : allowedAngles.includes(0)
    ? []
    : [0];

  const materials = extractMaterials(text, false);
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
    assumptions.push(
      "候选角度序列采用中面镜像对称；层间材料与厚度对称时 B 矩阵为零。",
    );
  }
  if (balancedSetting === null) {
    assumptions.push(
      "候选正负角层数相同；正负角层材料与厚度匹配时 A16、A26 相消。",
    );
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

function requireSameRequest(actual: unknown, expected: unknown, field: string) {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`设计服务返回的 ${field} 与请求不一致。`);
  }
}

export function validateDeterministicDesignResponse(
  response: unknown,
  intent: DeterministicDesignIntent,
): asserts response is DeterministicDesignServiceResponse {
  const value = validateDesignContract(response);
  if (value.generation_mode !== intent.mode)
    throw new Error("设计响应模式与请求不一致。");
  for (const [key, expected] of Object.entries(intent.payload)) {
    requireSameRequest(value.result.request[key], expected, key);
  }
}

export function validateFEMReadyDesignResponse(
  response: unknown,
  intent: FEMReadyDesignIntent,
): asserts response is FEMReadyDesignServiceResponse {
  const value = validateDesignContract(response);
  if (value.generation_mode !== intent.mode)
    throw new Error("设计响应模式与请求不一致。");
  const { request, source_table } = value.result;
  if (
    source_table.sha256 !== FEM_TABLE_SHA256 ||
    source_table.row_count !== 5857
  ) {
    throw new Error("FEM-ready 设计服务的数据源不一致。");
  }
  requireSameRequest(
    request.candidate_count,
    intent.candidateCount,
    "候选数量",
  );
  requireSameRequest(
    request.geometry,
    {
      length_mm: intent.payload.geometry.length_mm,
      radius_mm: intent.payload.geometry.radius_mm,
      thickness_mm:
        intent.payload.geometry.thickness_mm === undefined
          ? null
          : [intent.payload.geometry.thickness_mm],
      ...(intent.payload.geometry.imperfection_ratio === undefined
        ? {}
        : { imperfection_ratio: intent.payload.geometry.imperfection_ratio }),
    },
    "几何与缺陷",
  );
  for (const key of Object.keys(intent.payload.load_conditions) as Array<
    keyof FEMReadyDesignPayload["load_conditions"]
  >) {
    requireSameRequest(
      request.load_conditions[key],
      intent.payload.load_conditions[key],
      key,
    );
  }
  requireSameRequest(
    request.boundary_conditions.type,
    intent.payload.boundary_conditions?.type ?? "FLANGE_CONSTRAINED",
    "端部边界",
  );
  requireSameRequest(
    request.boundary_conditions.basis,
    intent.payload.boundary_conditions ? "user_input" : "modeling_assumption",
    "边界依据",
  );
  requireSameRequest(
    request.design_targets.safety_factor,
    intent.payload.design_targets?.safety_factor ?? null,
    "安全系数",
  );
  requireSameRequest(
    request.design_targets.primary_objective,
    intent.payload.design_targets?.primary_objective ?? "有限元校核后筛选",
    "设计目标",
  );
  if (intent.payload.materials)
    requireSameRequest(
      [...request.materials].sort(),
      [...intent.payload.materials].sort(),
      "材料",
    );
  requireSameRequest(
    request.structure_form,
    intent.payload.structure_form,
    "结构形式",
  );
  requireSameRequest(
    request.manufacturing_process,
    intent.payload.manufacturing_process,
    "制造工艺",
  );
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
      throw new Error("确定性设计服务请求超时。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// 解释输入和可见摘要使用同一份候选统计，不由模型复算数值或重新分类。
function describeDesignEvidence(response: DesignServiceResponse) {
  validateDesignInterpretationContext(response);
  const facts = response.interpretation_context.facts;
  const thicknessRange = (name: string) => {
    const values = facts[`${name}/mm`] as number[];
    const missing = Number(facts[`${name}未知的候选数量`]);
    if (!values.length) return `${name}待确定`;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = min === max ? `${min} mm` : `${min} 至 ${max} mm`;
    return `${name} ${range}${missing ? `，另有 ${missing} 组待确定` : ""}`;
  };
  const evidence = [
    `共 ${response.result.candidate_count} 组；角度序列镜像对称 ${facts["角度序列镜像对称的候选数量"]} 组，正负角层数均衡 ${facts["正负角层数均衡的候选数量"]} 组。`,
    `物理层数 ${(facts["物理层数"] as number[]).join(
      "、",
    )} 层；${thicknessRange("单层厚度")}；${thicknessRange("总厚度")}。`,
  ];
  const fem = response.generation_mode === "fem_ready_cylindrical_shell";
  const process = fem
    ? response.result.request.manufacturing_process
    : (facts["各候选共同参数"] as Record<string, unknown>)
        .manufacturing_process;
  evidence.push(`制造工艺：${process || "待确认"}。`);
  if (fem) {
    for (const name of ["候选来源分组", "历史参考与目标比较"]) {
      const groups = Object.entries(facts[name] as Record<string, number>);
      evidence.push(
        `${name}：${groups
          .map(([label, count]) => `${label} ${count} 组`)
          .join("，")}。`,
      );
    }
    evidence.push("当前圆柱段候选均未求解；历史参考只用于初筛。");
  } else {
    evidence.push("概念候选尚未进行有限元校核。");
  }
  return evidence;
}

export function buildDesignNarrativeInstruction(
  intent: DesignIntent,
  response: DesignServiceResponse,
) {
  if (intent.mode !== response.generation_mode) {
    throw new Error("设计意图与设计服务响应模式不一致。");
  }
  return (
    designNarrativeTask +
    "\n" +
    "角度镜像与正负角层数是不同统计，刚度结论还取决于材料、层厚和层序。来源分组与历史参考比较是各自统计。" +
    DESIGN_FACT_RULES +
    "\n\n工件事实：\n" +
    describeDesignEvidence(response).join("\n") +
    "\n用户明确输入：\n" +
    JSON.stringify(intent.facts) +
    "\n工具选择与建模依据（不是用户缺失字段列表）：\n" +
    JSON.stringify(intent.assumptions)
  );
}

export function renderDeterministicDesignAppendix(
  intent: DesignIntent,
  response: DesignServiceResponse,
) {
  if (intent.mode !== response.generation_mode)
    throw new Error("设计意图与设计响应模式不一致。");
  const fem = response.generation_mode === "fem_ready_cylindrical_shell";
  const title = fem ? "FEM-ready 圆柱壳候选" : "概念候选";
  const scope = fem
    ? "计算范围为复合材料圆柱段；金属封头和连接不在该子模型内。"
    : "铺层按外表面到内表面逐层展开。";
  return `\n\n## ${title}\n\n${scope}\n\n${describeDesignEvidence(
    response,
  ).join("\n\n")}\n\n${renderDesignTable(response)}\n\n设计结果指纹：\`${
    response.result.design_fingerprint
  }\`。`;
}
