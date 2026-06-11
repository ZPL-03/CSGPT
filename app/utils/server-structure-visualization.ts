import type { StructureVisualizationTrace } from "./structure-visualization-results";
import {
  lastUserMessageText,
  type ServerChatMessageLike,
} from "./server-message-content";

type Quantity = {
  value: number;
  unit?: string;
};

type StructureVisualizationContext = {
  message: string;
  visualizations: StructureVisualizationTrace[];
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

function lengthToM(quantity?: Quantity) {
  if (!quantity) return undefined;
  const unit = (quantity.unit || "m").toLowerCase();
  if (["km", "公里", "千米"].includes(unit)) return quantity.value * 1000;
  if (["mm", "毫米"].includes(unit)) return quantity.value / 1000;
  if (["cm", "厘米"].includes(unit)) return quantity.value / 100;
  return quantity.value;
}

function lengthToMm(quantity?: Quantity) {
  const valueM = lengthToM(quantity);
  return valueM === undefined ? undefined : valueM * 1000;
}

function parseStructureParameters(text: string) {
  const innerRadiusM = lengthToM(
    firstQuantity(text, [
      /(?:内半径|半径|inner\s*radius|radius)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
      /(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)\D{0,10}(?:内半径|半径|radius)/i,
    ]),
  );
  const lengthM = lengthToM(
    firstQuantity(text, [
      /(?:长度|壳长|筒长|length)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
      /(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)\D{0,10}(?:长度|壳长|筒长|length)/i,
    ]),
  );
  const thicknessM = lengthToM(
    firstQuantity(text, [
      /(?:厚度|壁厚|thickness)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
      /(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)\D{0,10}(?:厚度|壁厚|thickness)/i,
    ]),
  );
  const plyThicknessMm = lengthToMm(
    firstQuantity(text, [
      /(?:单层厚度|铺层厚度|每层厚度|ply\s*thickness)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );
  const totalLaminateThicknessMm = lengthToMm(
    firstQuantity(text, [
      /(?:总厚度|层合板厚度|laminate\s*thickness)\D{0,16}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );

  return {
    innerRadiusM,
    lengthM,
    thicknessM,
    plyThicknessMm,
    totalLaminateThicknessMm,
  };
}

function hasSphereIntent(text: string) {
  return /(球壳|球形|半球|spherical|sphere)/i.test(text);
}

function hasCylinderIntent(text: string) {
  return /(圆柱|筒|耐压壳|压力壳|压力容器|cylinder|cylindrical|pressure\s*(hull|vessel))/i.test(
    text,
  );
}

function hasVisualizationIntent(text: string) {
  return /(可视化|示意|画|图|结构图|截面|尺寸标注|visual|visualization|sketch|diagram|section)/i.test(
    text,
  );
}

function parseLayupAngles(text: string) {
  const bracketMatch = text.match(/[\[【（(]([^\]】）)]{3,160})[\]】）)]/);
  const source = bracketMatch?.[1] || text;
  const angles: number[] = [];
  const angleMatches = source.matchAll(/(±|\+|-)?\s*(0|15|30|45|60|75|90)\b/g);
  for (const match of angleMatches) {
    const sign = match[1] || "";
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    if (sign === "±") {
      angles.push(value, -value);
    } else if (sign === "-") {
      angles.push(-value);
    } else {
      angles.push(value);
    }
  }
  return angles.slice(0, 80);
}

function buildCylinderVisualization(
  id: string,
  params: ReturnType<typeof parseStructureParameters>,
): StructureVisualizationTrace | null {
  if (params.innerRadiusM === undefined || params.lengthM === undefined) {
    return null;
  }
  const outerRadiusM =
    params.thicknessM !== undefined
      ? params.innerRadiusM + params.thicknessM
      : undefined;
  const dimensions = [
    { label: "内半径", value: cleanNumber(params.innerRadiusM), unit: "m" },
    { label: "长度", value: cleanNumber(params.lengthM), unit: "m" },
    params.thicknessM !== undefined
      ? { label: "壁厚", value: cleanNumber(params.thicknessM), unit: "m" }
      : null,
    outerRadiusM !== undefined
      ? { label: "外半径", value: cleanNumber(outerRadiusM), unit: "m" }
      : null,
  ].filter(Boolean) as StructureVisualizationTrace["dimensions"];

  return {
    id,
    type: "cylindrical-shell",
    title: "圆柱壳结构示意",
    summary: "按当前问题中的圆柱壳尺寸生成结构示意和尺寸标注。",
    dimensions,
    geometry: {
      innerRadiusM: cleanNumber(params.innerRadiusM),
      outerRadiusM:
        outerRadiusM === undefined ? undefined : cleanNumber(outerRadiusM),
      lengthM: cleanNumber(params.lengthM),
      thicknessM:
        params.thicknessM === undefined
          ? undefined
          : cleanNumber(params.thicknessM),
    },
  };
}

function buildSphereVisualization(
  id: string,
  params: ReturnType<typeof parseStructureParameters>,
): StructureVisualizationTrace | null {
  if (params.innerRadiusM === undefined) return null;
  const outerRadiusM =
    params.thicknessM !== undefined
      ? params.innerRadiusM + params.thicknessM
      : undefined;

  return {
    id,
    type: "spherical-shell",
    title: "球壳结构示意",
    summary: "按当前问题中的球壳尺寸生成结构示意和尺寸标注。",
    dimensions: [
      { label: "内半径", value: cleanNumber(params.innerRadiusM), unit: "m" },
      params.thicknessM !== undefined
        ? { label: "壁厚", value: cleanNumber(params.thicknessM), unit: "m" }
        : null,
      outerRadiusM !== undefined
        ? { label: "外半径", value: cleanNumber(outerRadiusM), unit: "m" }
        : null,
    ].filter(Boolean) as StructureVisualizationTrace["dimensions"],
    geometry: {
      innerRadiusM: cleanNumber(params.innerRadiusM),
      outerRadiusM:
        outerRadiusM === undefined ? undefined : cleanNumber(outerRadiusM),
      thicknessM:
        params.thicknessM === undefined
          ? undefined
          : cleanNumber(params.thicknessM),
    },
  };
}

function buildLaminateVisualization(
  id: string,
  text: string,
  params: ReturnType<typeof parseStructureParameters>,
): StructureVisualizationTrace | null {
  const angles = parseLayupAngles(text);
  if (!angles.length) return null;

  const plyThicknessMm =
    params.plyThicknessMm ??
    (params.totalLaminateThicknessMm !== undefined
      ? params.totalLaminateThicknessMm / angles.length
      : undefined);
  if (plyThicknessMm === undefined || plyThicknessMm <= 0) return null;

  const layers = angles.map((angleDeg, index) => ({
    index: index + 1,
    angleDeg,
    thicknessMm: cleanNumber(plyThicknessMm),
  }));
  const totalThicknessMm = cleanNumber(
    layers.reduce((sum, layer) => sum + layer.thicknessMm, 0),
  );

  return {
    id,
    type: "laminate-section",
    title: "复合材料铺层截面",
    summary: "按当前问题中的铺层角和厚度生成铺层截面示意。",
    dimensions: [
      { label: "总厚度", value: totalThicknessMm, unit: "mm" },
      { label: "铺层数", value: layers.length, unit: "层" },
      { label: "单层厚度", value: cleanNumber(plyThicknessMm), unit: "mm" },
    ],
    geometry: {
      thicknessM: cleanNumber(totalThicknessMm / 1000),
    },
    laminate: {
      totalThicknessMm,
      layers,
    },
  };
}

function renderStructureVisualizationContext(
  visualizations: StructureVisualizationTrace[],
) {
  const blocks = visualizations.map((visualization) =>
    [
      `[${visualization.id}] ${visualization.title}`,
      visualization.summary,
      `尺寸: ${visualization.dimensions
        .map(
          (dimension) =>
            `${dimension.label} ${dimension.value} ${dimension.unit}`,
        )
        .join("，")}`,
    ].join("\n"),
  );

  return [
    "结构可视化结果",
    "这些结果来自本项目受控结构可视化工具。回答中可以说明示意图代表的尺寸、铺层和适用边界，不应把示意图表述为仿真结果。",
    ...blocks,
  ].join("\n\n");
}

export function buildExternalStructureVisualizationContext(
  messages: ServerChatMessageLike[],
): StructureVisualizationContext | null {
  const text = lastUserMessageText(messages);
  if (!text || !hasVisualizationIntent(text)) return null;

  const params = parseStructureParameters(text);
  const visualizations: StructureVisualizationTrace[] = [];
  const sphere = hasSphereIntent(text);
  const cylinder = hasCylinderIntent(text) || !sphere;

  if (sphere) {
    const visualization = buildSphereVisualization("V1", params);
    if (visualization) visualizations.push(visualization);
  }

  if (cylinder) {
    const visualization = buildCylinderVisualization(
      `V${visualizations.length + 1}`,
      params,
    );
    if (visualization) visualizations.push(visualization);
  }

  const laminate = buildLaminateVisualization(
    `V${visualizations.length + 1}`,
    text,
    params,
  );
  if (laminate) visualizations.push(laminate);

  if (!visualizations.length) return null;

  return {
    message: renderStructureVisualizationContext(visualizations),
    visualizations,
  };
}
