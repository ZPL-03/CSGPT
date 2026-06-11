import {
  executeDesignCalculation,
  getDesignCalculationCatalog,
  type DesignCalculationType,
} from "./design-calculation-registry";
import type { DesignCalculationTrace } from "./design-calculation-results";
import {
  lastUserMessageText,
  type ServerChatMessageLike,
} from "./server-message-content";

type Quantity = {
  value: number;
  unit?: string;
};

type DesignCalculationContext = {
  message: string;
  calculations: DesignCalculationTrace[];
};

const SEAWATER_DENSITY_KG_M3 = 1025;
const STANDARD_GRAVITY_MS2 = 9.80665;

const calculationTitles = new Map(
  getDesignCalculationCatalog().map((item) => [item.type, item.title]),
);

function toNumber(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstQuantity(text: string, patterns: RegExp[]): Quantity | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = toNumber(match?.groups?.value);
    if (value === undefined) continue;
    return {
      value,
      unit: match?.groups?.unit,
    };
  }
  return undefined;
}

function firstNumber(text: string, patterns: RegExp[]) {
  const quantity = firstQuantity(text, patterns);
  return quantity?.value;
}

function lengthToM(quantity?: Quantity) {
  if (!quantity) return undefined;
  const unit = (quantity.unit || "m").toLowerCase();
  if (["km", "公里", "千米"].includes(unit)) return quantity.value * 1000;
  if (["mm", "毫米"].includes(unit)) return quantity.value / 1000;
  if (["cm", "厘米"].includes(unit)) return quantity.value / 100;
  return quantity.value;
}

function pressureToMPa(quantity?: Quantity) {
  if (!quantity) return undefined;
  const unit = (quantity.unit || "mpa").toLowerCase();
  if (["gpa", "吉帕"].includes(unit)) return quantity.value * 1000;
  if (["pa"].includes(unit)) return quantity.value / 1_000_000;
  if (["kpa"].includes(unit)) return quantity.value / 1000;
  return quantity.value;
}

function densityToKgM3(quantity?: Quantity) {
  if (!quantity) return undefined;
  return quantity.value;
}

function extractParameters(text: string) {
  const depthM = lengthToM(
    firstQuantity(text, [
      /(?:工作深度|设计深度|水深|深度|depth)\D{0,12}(?<value>\d+(?:\.\d+)?)\s*(?<unit>km|公里|千米|m|米)?/i,
      /(?<value>\d+(?:\.\d+)?)\s*(?<unit>km|公里|千米|m|米)\D{0,8}(?:工作深度|设计深度|水深|深度|depth)/i,
    ]),
  );

  const pressureMPa = pressureToMPa(
    firstQuantity(text, [
      /(?:工作外压|设计外压|外压|压力|pressure)\D{0,12}(?<value>\d+(?:\.\d+)?)\s*(?<unit>gpa|mpa|kpa|pa|吉帕|兆帕)?/i,
      /(?<value>\d+(?:\.\d+)?)\s*(?<unit>gpa|mpa|kpa|pa|吉帕|兆帕)\D{0,8}(?:工作外压|设计外压|外压|压力|pressure)/i,
    ]),
  );

  const safetyFactor =
    firstNumber(text, [
      /(?:安全系数|安全因子|safety\s*factor|sf)\D{0,8}(?<value>\d+(?:\.\d+)?)/i,
    ]) ?? 1;

  const innerRadiusM = lengthToM(
    firstQuantity(text, [
      /(?:内半径|半径|inner\s*radius|radius)\D{0,12}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );

  const lengthM = lengthToM(
    firstQuantity(text, [
      /(?:长度|壳长|筒长|length)\D{0,12}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );

  const thicknessM = lengthToM(
    firstQuantity(text, [
      /(?:厚度|壁厚|thickness)\D{0,12}(?<value>\d+(?:\.\d+)?)\s*(?<unit>mm|毫米|cm|厘米|m|米)?/i,
    ]),
  );

  const allowableHoopStressMPa = pressureToMPa(
    firstQuantity(text, [
      /(?:许用环向应力|许用应力|allowable\s*hoop\s*stress|allowable\s*stress)\D{0,12}(?<value>\d+(?:\.\d+)?)\s*(?<unit>gpa|mpa|kpa|pa|吉帕|兆帕)?/i,
    ]),
  );

  const materialDensityKgM3 = densityToKgM3(
    firstQuantity(text, [
      /(?:材料密度|密度|density)\D{0,12}(?<value>\d+(?:\.\d+)?)\s*(?<unit>kg\/m3|kg\/m\^3|千克\/立方米)?/i,
    ]),
  );

  return {
    depthM,
    pressureMPa,
    safetyFactor,
    innerRadiusM,
    lengthM,
    thicknessM,
    allowableHoopStressMPa,
    materialDensityKgM3,
  };
}

function runCalculation(
  id: string,
  type: DesignCalculationType,
  input: unknown,
) {
  const output = executeDesignCalculation({ type, input });
  return {
    id,
    type,
    title: calculationTitles.get(type) || type,
    input,
    result: output.result,
  } satisfies DesignCalculationTrace;
}

function buildCalculations(text: string) {
  const params = extractParameters(text);
  const calculations: DesignCalculationTrace[] = [];
  let workingPressureMPa = params.pressureMPa;

  if (params.depthM !== undefined) {
    const input = {
      depthM: params.depthM,
      densityKgM3: SEAWATER_DENSITY_KG_M3,
      gravityMS2: STANDARD_GRAVITY_MS2,
      safetyFactor: params.safetyFactor,
    };
    const calculation = runCalculation("C1", "hydrostatic-pressure", input);
    calculations.push(calculation);
    workingPressureMPa = (calculation.result as any).pressureMPa;
  }

  if (
    params.innerRadiusM !== undefined &&
    workingPressureMPa !== undefined &&
    params.allowableHoopStressMPa !== undefined
  ) {
    calculations.push(
      runCalculation("C2", "preliminary-thickness", {
        innerRadiusM: params.innerRadiusM,
        pressureMPa: workingPressureMPa,
        allowableHoopStressMPa: params.allowableHoopStressMPa,
        safetyFactor: params.safetyFactor,
      }),
    );
  }

  if (
    params.innerRadiusM !== undefined &&
    params.lengthM !== undefined &&
    params.thicknessM !== undefined &&
    workingPressureMPa !== undefined &&
    params.materialDensityKgM3 !== undefined
  ) {
    calculations.push(
      runCalculation("C3", "cylindrical-shell", {
        innerRadiusM: params.innerRadiusM,
        lengthM: params.lengthM,
        thicknessM: params.thicknessM,
        pressureMPa: workingPressureMPa,
        densityKgM3: params.materialDensityKgM3,
        safetyFactor: params.safetyFactor,
      }),
    );
  }

  return calculations;
}

function renderCalculationContext(calculations: DesignCalculationTrace[]) {
  const blocks = calculations.map((calculation) =>
    [
      `[${calculation.id}] ${calculation.title}`,
      `计算类型: ${calculation.type}`,
      `输入: ${JSON.stringify(calculation.input)}`,
      `结果: ${JSON.stringify(calculation.result)}`,
    ].join("\n"),
  );

  return [
    "确定性设计计算结果",
    "这些结果来自本项目受控工程计算工具。回答中可以解释计算含义，不应把它们表述为模型推测。",
    ...blocks,
  ].join("\n\n");
}

export function buildExternalDesignCalculationContext(
  messages: ServerChatMessageLike[],
): DesignCalculationContext | null {
  const text = lastUserMessageText(messages);
  if (!text) return null;

  const calculations = buildCalculations(text);
  if (!calculations.length) return null;

  return {
    message: renderCalculationContext(calculations),
    calculations,
  };
}
