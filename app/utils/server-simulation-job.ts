import {
  lastUserMessageText,
  normalizeServerMessageText,
  type ServerChatMessageLike,
} from "./server-message-content";
import type { SimulationJobDraft } from "./simulation-job-results";

export type SimulationJobContext = {
  message: string;
  drafts: SimulationJobDraft[];
};

type Quantity = {
  value: number;
  unit?: string;
};

function cleanNumber(value: number) {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-10) return 0;
  return Number(value.toPrecision(12));
}

function toNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstQuantity(text: string, patterns: RegExp[]): Quantity | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = toNumber(match?.groups?.value);
    if (value === undefined) continue;
    return { value, unit: match?.groups?.unit };
  }
  return undefined;
}

function lengthToMm(quantity?: Quantity) {
  if (!quantity) return undefined;
  const unit = (quantity.unit || "mm").toLowerCase();
  if (["m", "米"].includes(unit)) return quantity.value * 1000;
  if (["cm", "厘米"].includes(unit)) return quantity.value * 10;
  if (["km", "公里", "千米"].includes(unit)) return quantity.value * 1_000_000;
  return quantity.value;
}

function pressureToMPa(quantity?: Quantity) {
  if (!quantity) return undefined;
  const unit = (quantity.unit || "MPa").toLowerCase();
  if (["pa", "帕"].includes(unit)) return quantity.value / 1_000_000;
  if (["kpa", "千帕"].includes(unit)) return quantity.value / 1000;
  if (["gpa", "吉帕"].includes(unit)) return quantity.value * 1000;
  return quantity.value;
}

function parseSolver(text: string): SimulationJobDraft["solver"] {
  if (/abaqus/i.test(text)) return "abaqus";
  if (/ansys/i.test(text)) return "ansys";
  if (/comsol/i.test(text)) return "comsol";
  if (/calculix|ccx/i.test(text)) return "calculix";
  return "custom";
}

function parseLayup(text: string) {
  const match = text.match(/[\[【（(]([^\]】）)]{3,180})[\]】）)]/);
  return match ? `[${match[1].trim()}]` : undefined;
}

function parseOutputs(text: string) {
  const outputs: string[] = [];
  const candidates: Array<[RegExp, string]> = [
    [/屈曲|buckling/i, "屈曲模态或屈曲载荷"],
    [/最大应力|stress/i, "最大应力"],
    [/位移|变形|displacement|deformation/i, "位移或变形"],
    [/失效|hashin|tsai|puck|failure/i, "失效指标"],
    [/安全系数|储备系数|reserve|factor/i, "安全系数或储备系数"],
    [/应变|strain/i, "应变"],
  ];
  for (const [pattern, label] of candidates) {
    if (pattern.test(text)) outputs.push(label);
  }
  return outputs.length ? outputs : ["求解状态", "关键响应指标"];
}

function parseDraft(text: string): SimulationJobDraft {
  const layup = parseLayup(text);
  const innerRadiusMm = lengthToMm(
    firstQuantity(text, [
      /(?:内半径|半径|inner\s*radius|radius)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );
  const lengthMm = lengthToMm(
    firstQuantity(text, [
      /(?:长度|壳长|筒长|length)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );
  const thicknessMm = lengthToMm(
    firstQuantity(text, [
      /(?:厚度|壁厚|thickness)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );
  const externalPressureMPa = pressureToMPa(
    firstQuantity(text, [
      /(?:外压|压力|external\s*pressure|pressure)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>pa|帕|kpa|千帕|mpa|兆帕|gpa|吉帕)?/i,
      /(?<value>\d+(?:\.\d+)?)\s*(?<unit>pa|帕|kpa|千帕|mpa|兆帕|gpa|吉帕)\D{0,10}(?:外压|压力|pressure)/i,
    ]),
  );
  const depthM = lengthToMm(
    firstQuantity(text, [
      /(?:深度|工作深度|depth)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>m|米|km|公里|千米)?/i,
    ]),
  );
  const depthValueM =
    depthM === undefined ? undefined : cleanNumber(depthM / 1000);

  const geometry: Record<string, number | string> = {};
  if (innerRadiusMm !== undefined)
    geometry.innerRadiusMm = cleanNumber(innerRadiusMm);
  if (lengthMm !== undefined) geometry.lengthMm = cleanNumber(lengthMm);
  if (thicknessMm !== undefined)
    geometry.thicknessMm = cleanNumber(thicknessMm);
  if (/球壳|球形|sphere|spherical/i.test(text)) {
    geometry.type = "spherical-shell";
  } else if (
    /圆柱|筒|耐压壳|压力壳|pressure\s*(hull|vessel)|cylinder/i.test(text)
  ) {
    geometry.type = "cylindrical-shell";
  }

  const load: Record<string, number | string> = {};
  if (externalPressureMPa !== undefined) {
    load.externalPressureMPa = cleanNumber(externalPressureMPa);
  }
  if (depthValueM !== undefined) load.depthM = depthValueM;

  const material: Record<string, string> = {};
  const materialMatches = text.match(
    /(T700\/Epoxy|M40J\/TDE-85|碳纤维|玻璃纤维|环氧|carbon\s*fiber|glass\s*fiber|epoxy)/gi,
  );
  if (materialMatches?.length) {
    material.name = Array.from(new Set(materialMatches)).join(", ");
  }

  const boundaryConditions: string[] = [];
  if (/简支|simply\s*supported/i.test(text)) boundaryConditions.push("简支");
  if (/固支|固定|clamped|fixed/i.test(text)) boundaryConditions.push("固支");
  if (/自由|free/i.test(text)) boundaryConditions.push("自由边界");

  const mesh: Record<string, number | string> = {};
  if (/网格|mesh/i.test(text)) mesh.strategy = "按壳体和铺层建模要求细化";

  const missingFields = [
    Object.keys(geometry).length ? "" : "几何尺寸",
    Object.keys(load).length ? "" : "载荷或工况",
    Object.keys(material).length ? "" : "材料参数",
    layup ? "" : "铺层定义",
    boundaryConditions.length ? "" : "边界条件",
  ].filter(Boolean);

  return {
    id: "S1",
    title: "有限元仿真任务草案",
    solver: parseSolver(text),
    summary:
      "根据当前问题整理有限元任务输入；该草案不包含求解结果，结果必须由外部求解器返回。",
    input: {
      ...(Object.keys(geometry).length ? { geometry } : {}),
      ...(Object.keys(load).length ? { load } : {}),
      ...(Object.keys(material).length ? { material } : {}),
      ...(layup ? { layup } : {}),
      ...(boundaryConditions.length ? { boundaryConditions } : {}),
      ...(Object.keys(mesh).length ? { mesh } : {}),
      outputs: parseOutputs(text),
      missingFields,
    },
  };
}

function renderDraft(draft: SimulationJobDraft) {
  const input = draft.input;
  return [
    `[${draft.id}] ${draft.title}`,
    `求解器: ${draft.solver}`,
    `摘要: ${draft.summary}`,
    input.geometry ? `几何: ${JSON.stringify(input.geometry)}` : "",
    input.load ? `载荷: ${JSON.stringify(input.load)}` : "",
    input.material ? `材料: ${JSON.stringify(input.material)}` : "",
    input.layup ? `铺层: ${input.layup}` : "",
    input.boundaryConditions?.length
      ? `边界条件: ${input.boundaryConditions.join("，")}`
      : "",
    `输出指标: ${input.outputs.join("，")}`,
    input.missingFields.length
      ? `缺失参数: ${input.missingFields.join("，")}`
      : "缺失参数: 无",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildExternalSimulationJobContext(
  messages: ServerChatMessageLike[],
): SimulationJobContext | null {
  const query = normalizeServerMessageText(lastUserMessageText(messages));
  if (!query) return null;
  const draft = parseDraft(query);

  return {
    drafts: [draft],
    message: [
      "当前请求涉及有限元或仿真任务。",
      "平台仿真任务只记录结构化输入、求解器、状态和外部求解器返回结果。",
      "没有真实求解器结果时，不得输出云图、位移、应力、屈曲载荷、储备系数或收敛结论等仿真结果。",
      "回答应围绕几何、材料、铺层、载荷、边界条件、网格、求解器和后处理指标整理任务输入；参数不足时列出缺失项，参数充分时说明可创建待提交仿真任务。",
      renderDraft(draft),
    ].join("\n"),
  };
}
