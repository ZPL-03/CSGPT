import { z, ZodError } from "zod";

import {
  calculateCylindricalShell,
  calculateHashinFailure,
  calculateHydrostaticPressure,
  calculateLaminateAbd,
  calculateMaximumStressFailure,
  calculatePreliminaryThickness,
  calculateTsaiWuFailure,
  screenDesignCandidates,
  searchLayupAngles,
  summarizeLayup,
} from "@/app/utils/design-calculation";

const finiteNumber = z
  .number({
    required_error: "必填",
    invalid_type_error: "必须是数值",
  })
  .finite("必须是有限数值");
const positiveNumber = finiteNumber.positive("必须大于 0");
const nonNegativeNumber = finiteNumber.min(0, "不能小于 0");

const hydrostaticPressureSchema = z.object({
  depthM: nonNegativeNumber,
  densityKgM3: positiveNumber,
  gravityMS2: positiveNumber,
  safetyFactor: positiveNumber,
});

const cylindricalShellSchema = z.object({
  innerRadiusM: positiveNumber,
  lengthM: positiveNumber,
  thicknessM: positiveNumber,
  pressureMPa: nonNegativeNumber,
  densityKgM3: positiveNumber,
  safetyFactor: positiveNumber,
});

const preliminaryThicknessSchema = z.object({
  innerRadiusM: positiveNumber,
  pressureMPa: nonNegativeNumber,
  allowableHoopStressMPa: positiveNumber,
  safetyFactor: positiveNumber,
});

const plySchema = z.object({
  angleDeg: finiteNumber,
  thicknessMm: positiveNumber,
  materialName: z.string().trim().min(1, "不能为空").optional(),
});

const layupSummarySchema = z.object({
  plies: z.array(plySchema).min(1, "至少需要 1 层铺层"),
});

const orthotropicLaminaSchema = z.object({
  e1GPa: positiveNumber,
  e2GPa: positiveNumber,
  g12GPa: positiveNumber,
  nu12: finiteNumber.min(0, "不能小于 0").lt(1, "必须小于 1"),
});

const laminateAbdSchema = z.object({
  lamina: orthotropicLaminaSchema,
  plies: z.array(plySchema).min(1, "至少需要 1 层铺层"),
});

const planeStressSchema = z.object({
  sigma1MPa: finiteNumber,
  sigma2MPa: finiteNumber,
  tau12MPa: finiteNumber,
});

const strengthSchema = z.object({
  xtMPa: positiveNumber,
  xcMPa: positiveNumber,
  ytMPa: positiveNumber,
  ycMPa: positiveNumber,
  s12MPa: positiveNumber,
});

const failureCriteriaSchema = z.object({
  stress: planeStressSchema,
  strengths: strengthSchema,
});

const tsaiWuSchema = failureCriteriaSchema.extend({
  interactionCoefficient: finiteNumber,
});

const layupAngleSearchSchema = z.object({
  lamina: orthotropicLaminaSchema,
  angleCandidatesDeg: z
    .array(finiteNumber.min(0, "不能小于 0").lt(90, "必须小于 90"))
    .min(1, "至少需要 1 个候选角度")
    .max(100, "候选角度不能超过 100 个"),
  plyThicknessMm: positiveNumber,
  anglePairRepeats: z
    .number()
    .int("必须是整数")
    .positive("必须大于 0")
    .max(200, "角度对重复次数不能超过 200"),
  hoopPliesPerSide: z
    .number()
    .int("必须是整数")
    .min(0, "不能小于 0")
    .max(200, "单侧 90 度铺层数不能超过 200"),
  mirrorSymmetric: z.boolean(),
  materialName: z.string().trim().min(1, "不能为空").optional(),
  objectiveWeights: z
    .object({
      axialStiffness: nonNegativeNumber.optional(),
      hoopStiffness: nonNegativeNumber.optional(),
      shearStiffness: nonNegativeNumber.optional(),
      couplingPenalty: nonNegativeNumber.optional(),
    })
    .optional(),
  topK: z
    .number()
    .int("必须是整数")
    .positive("必须大于 0")
    .max(50, "最多返回 50 个候选方案"),
});

const screeningMetricSchema = z.enum([
  "massKg",
  "thicknessMm",
  "failureIndex",
  "reserveFactor",
  "cost",
  "manufacturabilityScore",
]);

const designScreeningCandidateSchema = z.object({
  id: z.string().trim().min(1, "不能为空"),
  name: z.string().trim().min(1, "不能为空").optional(),
  massKg: nonNegativeNumber.optional(),
  thicknessMm: nonNegativeNumber.optional(),
  failureIndex: nonNegativeNumber.optional(),
  reserveFactor: nonNegativeNumber.optional(),
  cost: nonNegativeNumber.optional(),
  manufacturabilityScore: nonNegativeNumber.optional(),
});

const multiObjectiveScreeningSchema = z.object({
  candidates: z
    .array(designScreeningCandidateSchema)
    .min(2, "至少需要 2 个候选方案")
    .max(200, "候选方案不能超过 200 个"),
  objectives: z
    .array(
      z.object({
        metric: screeningMetricSchema,
        direction: z.enum(["minimize", "maximize"]),
        weight: positiveNumber,
      }),
    )
    .min(1, "至少需要 1 个目标")
    .max(8, "目标数量不能超过 8 个"),
  topK: z
    .number()
    .int("必须是整数")
    .positive("必须大于 0")
    .max(50, "最多返回 50 个候选方案"),
});

const pathSchema = z
  .string()
  .trim()
  .min(1, "不能为空")
  .regex(/^[A-Za-z0-9_.]+$/, "只能包含字母、数字、下划线和点号");

const parameterSensitivitySchema = z.object({
  calculationType: z.enum([
    "hydrostatic-pressure",
    "cylindrical-shell",
    "preliminary-thickness",
    "layup-summary",
    "laminate-abd",
    "maximum-stress",
    "hashin",
    "tsai-wu",
  ]),
  baseInput: z.unknown(),
  parameterPath: pathSchema,
  values: z
    .array(finiteNumber)
    .min(2, "至少需要 2 个扫参取值")
    .max(100, "扫参取值不能超过 100 个"),
  metricPath: pathSchema,
});

const baseCalculationEntries = [
  {
    type: "hydrostatic-pressure",
    title: "静水外压换算",
    description:
      "按深度、流体密度、重力加速度和安全系数计算工作外压与设计外压。",
    schema: hydrostaticPressureSchema,
    run: calculateHydrostaticPressure,
  },
  {
    type: "cylindrical-shell",
    title: "圆柱壳膜应力与质量估算",
    description:
      "按薄壁圆柱壳膜应力模型估算环向应力、轴向应力、壁体体积和质量。",
    schema: cylindricalShellSchema,
    run: calculateCylindricalShell,
  },
  {
    type: "preliminary-thickness",
    title: "初始厚度估算",
    description: "按环向膜应力控制条件估算圆柱壳初始壁厚。",
    schema: preliminaryThicknessSchema,
    run: calculatePreliminaryThickness,
  },
  {
    type: "layup-summary",
    title: "铺层比例统计",
    description: "统计铺层总厚度、角度比例、角度族比例和材料比例。",
    schema: layupSummarySchema,
    run: summarizeLayup,
  },
  {
    type: "laminate-abd",
    title: "经典层合板 ABD 矩阵",
    description:
      "按正交单层平面应力刚度和铺层序列计算 A、B、D 矩阵与等效面内工程常数。",
    schema: laminateAbdSchema,
    run: calculateLaminateAbd,
  },
  {
    type: "maximum-stress",
    title: "最大应力失效判据",
    description: "按 1-2 坐标系平面应力和单层强度计算最大应力失效指数。",
    schema: failureCriteriaSchema,
    run: calculateMaximumStressFailure,
  },
  {
    type: "hashin",
    title: "Hashin 平面应力失效判据",
    description:
      "按纤维拉伸、纤维压缩、基体拉伸和基体压缩模式计算 Hashin 失效指数。",
    schema: failureCriteriaSchema,
    run: calculateHashinFailure,
  },
  {
    type: "tsai-wu",
    title: "Tsai-Wu 失效判据",
    description:
      "按 1-2 坐标系平面应力、单层强度和交互系数计算 Tsai-Wu 失效指数。",
    schema: tsaiWuSchema,
    run: calculateTsaiWuFailure,
  },
] as const;

function readPath(value: unknown, rawPath: string) {
  return rawPath
    .split(".")
    .reduce<any>((current, key) => current?.[key], value);
}

function writePath(value: unknown, rawPath: string, nextValue: number) {
  const clone = JSON.parse(JSON.stringify(value));
  const keys = rawPath.split(".");
  let cursor = clone;
  for (const key of keys.slice(0, -1)) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      throw new Error(`参数路径不存在：${rawPath}`);
    }
    cursor = cursor[key];
  }
  const lastKey = keys[keys.length - 1];
  if (!cursor || typeof cursor !== "object" || !(lastKey in cursor)) {
    throw new Error(`参数路径不存在：${rawPath}`);
  }
  cursor[lastKey] = nextValue;
  return clone;
}

function numericPath(value: unknown, rawPath: string, label: string) {
  const rawValue = readPath(value, rawPath);
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    throw new Error(`${label} 不是有限数值：${rawPath}`);
  }
  return rawValue;
}

function runParameterSensitivity(
  input: z.infer<typeof parameterSensitivitySchema>,
) {
  const definition = baseCalculationEntries.find(
    (entry) => entry.type === input.calculationType,
  );
  if (!definition) {
    throw new UnsupportedDesignCalculationError(input.calculationType);
  }

  const baseParsedInput = definition.schema.parse(input.baseInput) as never;
  const baseResult = definition.run(baseParsedInput);
  const baseParameterValue = numericPath(
    input.baseInput,
    input.parameterPath,
    "基准参数",
  );
  const baseMetricValue = numericPath(baseResult, input.metricPath, "基准指标");

  const samples = input.values.map((value) => {
    const sampleInput = writePath(input.baseInput, input.parameterPath, value);
    const parsedInput = definition.schema.parse(sampleInput) as never;
    const result = definition.run(parsedInput);
    const metricValue = numericPath(result, input.metricPath, "扫参指标");
    const parameterChangeRatio =
      baseParameterValue !== 0
        ? (value - baseParameterValue) / Math.abs(baseParameterValue)
        : null;
    const metricChangeRatio =
      baseMetricValue !== 0
        ? (metricValue - baseMetricValue) / Math.abs(baseMetricValue)
        : null;
    const elasticity =
      parameterChangeRatio !== null &&
      parameterChangeRatio !== 0 &&
      metricChangeRatio !== null
        ? metricChangeRatio / parameterChangeRatio
        : null;

    return {
      parameterValue: value,
      metricValue,
      parameterChangeRatio:
        parameterChangeRatio === null
          ? null
          : Number(parameterChangeRatio.toPrecision(12)),
      metricChangeRatio:
        metricChangeRatio === null
          ? null
          : Number(metricChangeRatio.toPrecision(12)),
      elasticity:
        elasticity === null ? null : Number(elasticity.toPrecision(12)),
      result,
    };
  });

  return {
    calculationType: input.calculationType,
    parameterPath: input.parameterPath,
    metricPath: input.metricPath,
    baseParameterValue,
    baseMetricValue,
    samples,
  };
}

const calculationEntries = [
  ...baseCalculationEntries,
  {
    type: "layup-angle-search",
    title: "铺层角度候选搜索",
    description:
      "按候选角度生成平衡铺层序列，计算 ABD 等效工程常数，并按刚度与耦合惩罚目标排序。",
    schema: layupAngleSearchSchema,
    run: searchLayupAngles,
  },
  {
    type: "multi-objective-screening",
    title: "多目标方案筛选",
    description:
      "按质量、厚度、失效指数、储备系数、成本和制造性等数值指标对候选方案加权排序，并标识 Pareto 有效方案。",
    schema: multiObjectiveScreeningSchema,
    run: screenDesignCandidates,
  },
  {
    type: "parameter-sensitivity",
    title: "参数敏感性分析",
    description:
      "对已有设计计算类型的指定输入参数执行扫参，输出目标指标变化和局部弹性系数。",
    schema: parameterSensitivitySchema,
    run: runParameterSensitivity,
  },
] as const;

const bodyEnvelopeSchema = z.object({
  type: z.string().trim().min(1, "计算类型不能为空"),
  input: z.unknown(),
});

export const DESIGN_CALCULATION_TOOL = {
  name: "run_design_calculation",
  description:
    "执行复合材料结构设计中的确定性工程计算，输入计算类型和结构化参数，返回数值结果。",
};

export type DesignCalculationType = (typeof calculationEntries)[number]["type"];

export class UnsupportedDesignCalculationError extends Error {
  constructor(type: string) {
    super(`不支持的计算类型：${type}`);
    this.name = "UnsupportedDesignCalculationError";
  }
}

export function getDesignCalculationCatalog() {
  return calculationEntries.map(({ type, title, description }) => ({
    type,
    title,
    description,
  }));
}

export function getDesignCalculationToolCatalog() {
  return {
    tool: DESIGN_CALCULATION_TOOL,
    calculations: getDesignCalculationCatalog(),
  };
}

export function formatDesignCalculationValidationError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function executeDesignCalculation(rawBody: unknown) {
  const body = bodyEnvelopeSchema.parse(rawBody);
  const definition = calculationEntries.find(
    (entry) => entry.type === body.type,
  );

  if (!definition) {
    throw new UnsupportedDesignCalculationError(body.type);
  }

  const input = definition.schema.parse(body.input) as never;
  const result = definition.run(input);

  return {
    type: definition.type,
    result,
  };
}
