type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export type HydrostaticPressureInput = {
  depthM: number;
  densityKgM3: number;
  gravityMS2: number;
  safetyFactor: number;
};

export type CylindricalShellInput = {
  innerRadiusM: number;
  lengthM: number;
  thicknessM: number;
  pressureMPa: number;
  densityKgM3: number;
  safetyFactor: number;
};

export type PreliminaryThicknessInput = {
  innerRadiusM: number;
  pressureMPa: number;
  allowableHoopStressMPa: number;
  safetyFactor: number;
};

export type PlyDefinition = {
  angleDeg: number;
  thicknessMm: number;
  materialName?: string;
};

export type LayupSummaryInput = {
  plies: PlyDefinition[];
};

export type OrthotropicLaminaInput = {
  e1GPa: number;
  e2GPa: number;
  g12GPa: number;
  nu12: number;
};

export type LaminateAbdInput = {
  lamina: OrthotropicLaminaInput;
  plies: PlyDefinition[];
};

export type PlaneStressInput = {
  sigma1MPa: number;
  sigma2MPa: number;
  tau12MPa: number;
};

export type StrengthInput = {
  xtMPa: number;
  xcMPa: number;
  ytMPa: number;
  ycMPa: number;
  s12MPa: number;
};

export type TsaiWuInput = {
  stress: PlaneStressInput;
  strengths: StrengthInput;
  interactionCoefficient: number;
};

export type FailureCriteriaInput = {
  stress: PlaneStressInput;
  strengths: StrengthInput;
};

export type LayupAngleSearchWeights = {
  axialStiffness?: number;
  hoopStiffness?: number;
  shearStiffness?: number;
  couplingPenalty?: number;
};

export type LayupAngleSearchInput = {
  lamina: OrthotropicLaminaInput;
  angleCandidatesDeg: number[];
  plyThicknessMm: number;
  anglePairRepeats: number;
  hoopPliesPerSide: number;
  mirrorSymmetric: boolean;
  materialName?: string;
  objectiveWeights?: LayupAngleSearchWeights;
  topK: number;
};

export type ScreeningObjective = {
  metric: string;
  direction: "minimize" | "maximize";
  weight: number;
};

export type DesignScreeningCandidate = {
  id: string;
  name?: string;
  massKg?: number;
  thicknessMm?: number;
  failureIndex?: number;
  reserveFactor?: number;
  cost?: number;
  manufacturabilityScore?: number;
};

export type MultiObjectiveScreeningInput = {
  candidates: DesignScreeningCandidate[];
  objectives: ScreeningObjective[];
  topK: number;
};

function cleanNumber(value: number) {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-10) return 0;
  return Number(value.toPrecision(12));
}

function cleanMatrix(matrix: Matrix3): Matrix3 {
  return matrix.map((row) => row.map(cleanNumber)) as Matrix3;
}

function finiteReserveFactor(value: number | null) {
  return value !== null && Number.isFinite(value) && value >= 0
    ? cleanNumber(value)
    : null;
}

export function calculateHydrostaticPressure(input: HydrostaticPressureInput) {
  const pressurePa = input.densityKgM3 * input.gravityMS2 * input.depthM;
  const pressureMPa = pressurePa / 1_000_000;
  const designPressureMPa = pressureMPa * input.safetyFactor;

  return {
    pressurePa: cleanNumber(pressurePa),
    pressureMPa: cleanNumber(pressureMPa),
    designPressureMPa: cleanNumber(designPressureMPa),
    assumptions: {
      depthM: input.depthM,
      densityKgM3: input.densityKgM3,
      gravityMS2: input.gravityMS2,
      safetyFactor: input.safetyFactor,
    },
  };
}

export function calculateCylindricalShell(input: CylindricalShellInput) {
  const designPressureMPa = input.pressureMPa * input.safetyFactor;
  const designPressurePa = designPressureMPa * 1_000_000;
  const meanRadiusM = input.innerRadiusM + input.thicknessM / 2;
  const hoopStressMPa =
    (designPressurePa * meanRadiusM) / input.thicknessM / 1_000_000;
  const axialStressMPa = hoopStressMPa / 2;
  const outsideRadiusM = input.innerRadiusM + input.thicknessM;
  const wallVolumeM3 =
    Math.PI *
    (outsideRadiusM * outsideRadiusM -
      input.innerRadiusM * input.innerRadiusM) *
    input.lengthM;
  const shellMassKg = wallVolumeM3 * input.densityKgM3;

  return {
    designPressureMPa: cleanNumber(designPressureMPa),
    hoopStressMPa: cleanNumber(hoopStressMPa),
    axialStressMPa: cleanNumber(axialStressMPa),
    wallVolumeM3: cleanNumber(wallVolumeM3),
    shellMassKg: cleanNumber(shellMassKg),
    assumptions: {
      stressModel: "thin cylindrical shell membrane stress magnitude",
      radiusReference: "inner radius plus half thickness",
      endCondition: "closed-end axial membrane stress magnitude",
    },
  };
}

export function calculatePreliminaryThickness(
  input: PreliminaryThicknessInput,
) {
  const designPressureMPa = input.pressureMPa * input.safetyFactor;
  const requiredThicknessM =
    (designPressureMPa * input.innerRadiusM) / input.allowableHoopStressMPa;

  return {
    designPressureMPa: cleanNumber(designPressureMPa),
    requiredThicknessM: cleanNumber(requiredThicknessM),
    requiredThicknessMm: cleanNumber(requiredThicknessM * 1000),
    assumptions: {
      stressModel: "thin cylindrical shell hoop membrane stress",
      governingStress: "allowable hoop stress",
    },
  };
}

function normalizeAngle(angleDeg: number) {
  let angle = angleDeg % 180;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  if (Object.is(angle, -0)) return 0;
  return Number(angle.toFixed(6));
}

function angleLabel(angleDeg: number) {
  const normalized = normalizeAngle(angleDeg);
  return `${normalized}`;
}

export function summarizeLayup(input: LayupSummaryInput) {
  const totalThicknessMm = input.plies.reduce(
    (sum, ply) => sum + ply.thicknessMm,
    0,
  );
  const signedAngles = new Map<
    string,
    { count: number; thicknessMm: number }
  >();
  const angleFamilies = new Map<
    string,
    { count: number; thicknessMm: number }
  >();
  const materials = new Map<string, { count: number; thicknessMm: number }>();

  for (const ply of input.plies) {
    const signed = angleLabel(ply.angleDeg);
    const family = `${Math.abs(normalizeAngle(ply.angleDeg))}`;
    const material = ply.materialName?.trim();
    const signedValue = signedAngles.get(signed) || {
      count: 0,
      thicknessMm: 0,
    };
    signedValue.count += 1;
    signedValue.thicknessMm += ply.thicknessMm;
    signedAngles.set(signed, signedValue);

    const familyValue = angleFamilies.get(family) || {
      count: 0,
      thicknessMm: 0,
    };
    familyValue.count += 1;
    familyValue.thicknessMm += ply.thicknessMm;
    angleFamilies.set(family, familyValue);

    if (material) {
      const materialValue = materials.get(material) || {
        count: 0,
        thicknessMm: 0,
      };
      materialValue.count += 1;
      materialValue.thicknessMm += ply.thicknessMm;
      materials.set(material, materialValue);
    }
  }

  const toRows = (map: Map<string, { count: number; thicknessMm: number }>) =>
    Array.from(map.entries())
      .map(([label, value]) => ({
        label,
        count: value.count,
        thicknessMm: cleanNumber(value.thicknessMm),
        ratio:
          totalThicknessMm > 0
            ? cleanNumber(value.thicknessMm / totalThicknessMm)
            : 0,
      }))
      .sort(
        (a, b) =>
          b.thicknessMm - a.thicknessMm || a.label.localeCompare(b.label),
      );

  return {
    plyCount: input.plies.length,
    totalThicknessMm: cleanNumber(totalThicknessMm),
    signedAngles: toRows(signedAngles),
    angleFamilies: toRows(angleFamilies),
    materials: toRows(materials),
  };
}

function transformedReducedStiffness(
  lamina: OrthotropicLaminaInput,
  angleDeg: number,
): Matrix3 {
  const e1 = lamina.e1GPa * 1000;
  const e2 = lamina.e2GPa * 1000;
  const g12 = lamina.g12GPa * 1000;
  const nu21 = (lamina.nu12 * e2) / e1;
  const denominator = 1 - lamina.nu12 * nu21;
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new Error("正交单层材料参数不满足平面应力刚度矩阵稳定条件。");
  }
  const q11 = e1 / denominator;
  const q22 = e2 / denominator;
  const q12 = (lamina.nu12 * e2) / denominator;
  const q66 = g12;

  const rad = (angleDeg * Math.PI) / 180;
  const m = Math.cos(rad);
  const n = Math.sin(rad);
  const m2 = m * m;
  const n2 = n * n;
  const m4 = m2 * m2;
  const n4 = n2 * n2;
  const mn = m * n;

  const q16 =
    (q11 - q12 - 2 * q66) * m * m * m * n -
    (q22 - q12 - 2 * q66) * m * n * n * n;
  const q26 =
    (q11 - q12 - 2 * q66) * m * n * n * n -
    (q22 - q12 - 2 * q66) * m * m * m * n;

  return [
    [
      q11 * m4 + 2 * (q12 + 2 * q66) * m2 * n2 + q22 * n4,
      (q11 + q22 - 4 * q66) * m2 * n2 + q12 * (m4 + n4),
      q16,
    ],
    [
      (q11 + q22 - 4 * q66) * m2 * n2 + q12 * (m4 + n4),
      q11 * n4 + 2 * (q12 + 2 * q66) * m2 * n2 + q22 * m4,
      q26,
    ],
    [q16, q26, (q11 + q22 - 2 * q12 - 2 * q66) * m2 * n2 + q66 * (m4 + n4)],
  ];
}

function zeroMatrix(): Matrix3 {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
}

function addScaledMatrix(target: Matrix3, source: Matrix3, scale: number) {
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      target[i][j] += source[i][j] * scale;
    }
  }
}

function invertMatrix3(matrix: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const determinant =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

  if (Math.abs(determinant) < 1e-12) {
    throw new Error("层合板 A 矩阵不可逆，不能计算等效面内工程常数。");
  }

  return [
    [
      (e * i - f * h) / determinant,
      (c * h - b * i) / determinant,
      (b * f - c * e) / determinant,
    ],
    [
      (f * g - d * i) / determinant,
      (a * i - c * g) / determinant,
      (c * d - a * f) / determinant,
    ],
    [
      (d * h - e * g) / determinant,
      (b * g - a * h) / determinant,
      (a * e - b * d) / determinant,
    ],
  ];
}

export function calculateLaminateAbd(input: LaminateAbdInput) {
  const totalThicknessMm = input.plies.reduce(
    (sum, ply) => sum + ply.thicknessMm,
    0,
  );
  let zBottom = -totalThicknessMm / 2;
  const a = zeroMatrix();
  const b = zeroMatrix();
  const d = zeroMatrix();
  const transformedPlies = input.plies.map((ply, index) => {
    const zTop = zBottom + ply.thicknessMm;
    const qbar = transformedReducedStiffness(input.lamina, ply.angleDeg);
    addScaledMatrix(a, qbar, zTop - zBottom);
    addScaledMatrix(b, qbar, (zTop * zTop - zBottom * zBottom) / 2);
    addScaledMatrix(d, qbar, (zTop ** 3 - zBottom ** 3) / 3);
    const row = {
      index,
      angleDeg: ply.angleDeg,
      thicknessMm: ply.thicknessMm,
      zBottomMm: zBottom,
      zTopMm: zTop,
      qbarMPa: cleanMatrix(qbar),
    };
    zBottom = zTop;
    return row;
  });
  const complianceA = invertMatrix3(a);
  const exMPa = 1 / (complianceA[0][0] * totalThicknessMm);
  const eyMPa = 1 / (complianceA[1][1] * totalThicknessMm);
  const gxyMPa = 1 / (complianceA[2][2] * totalThicknessMm);
  const nuxy = -complianceA[0][1] / complianceA[0][0];

  return {
    totalThicknessMm: cleanNumber(totalThicknessMm),
    aMatrixNPerMm: cleanMatrix(a),
    bMatrixN: cleanMatrix(b),
    dMatrixNmm: cleanMatrix(d),
    effectiveEngineeringConstants: {
      exGPa: cleanNumber(exMPa / 1000),
      eyGPa: cleanNumber(eyMPa / 1000),
      gxyGPa: cleanNumber(gxyMPa / 1000),
      nuxy: cleanNumber(nuxy),
    },
    plies: transformedPlies,
  };
}

export function calculateMaximumStressFailure(input: FailureCriteriaInput) {
  const { stress, strengths } = input;
  const fiberIndex =
    stress.sigma1MPa >= 0
      ? stress.sigma1MPa / strengths.xtMPa
      : Math.abs(stress.sigma1MPa) / strengths.xcMPa;
  const matrixIndex =
    stress.sigma2MPa >= 0
      ? stress.sigma2MPa / strengths.ytMPa
      : Math.abs(stress.sigma2MPa) / strengths.ycMPa;
  const shearIndex = Math.abs(stress.tau12MPa) / strengths.s12MPa;
  const failureIndex = Math.max(fiberIndex, matrixIndex, shearIndex);

  return {
    failureIndex: cleanNumber(failureIndex),
    reserveFactor: finiteReserveFactor(
      failureIndex > 0 ? 1 / failureIndex : null,
    ),
    components: {
      fiberIndex: cleanNumber(fiberIndex),
      matrixIndex: cleanNumber(matrixIndex),
      shearIndex: cleanNumber(shearIndex),
    },
  };
}

export function calculateHashinFailure(input: FailureCriteriaInput) {
  const { stress, strengths } = input;
  const tauTerm = (stress.tau12MPa / strengths.s12MPa) ** 2;
  const fiberTension =
    stress.sigma1MPa >= 0
      ? (stress.sigma1MPa / strengths.xtMPa) ** 2 + tauTerm
      : 0;
  const fiberCompression =
    stress.sigma1MPa < 0 ? (stress.sigma1MPa / strengths.xcMPa) ** 2 : 0;
  const matrixTension =
    stress.sigma2MPa >= 0
      ? (stress.sigma2MPa / strengths.ytMPa) ** 2 + tauTerm
      : 0;
  const matrixCompression =
    stress.sigma2MPa < 0
      ? (stress.sigma2MPa / (2 * strengths.s12MPa)) ** 2 +
        ((strengths.ycMPa / (2 * strengths.s12MPa)) ** 2 - 1) *
          (stress.sigma2MPa / strengths.ycMPa) +
        tauTerm
      : 0;
  const failureIndex = Math.max(
    fiberTension,
    fiberCompression,
    matrixTension,
    matrixCompression,
  );

  return {
    failureIndex: cleanNumber(failureIndex),
    reserveFactor: finiteReserveFactor(
      failureIndex > 0 ? 1 / Math.sqrt(failureIndex) : null,
    ),
    components: {
      fiberTension: cleanNumber(fiberTension),
      fiberCompression: cleanNumber(fiberCompression),
      matrixTension: cleanNumber(matrixTension),
      matrixCompression: cleanNumber(matrixCompression),
    },
  };
}

function solveTsaiWuReserveFactor(linear: number, quadratic: number) {
  if (Math.abs(quadratic) < 1e-14) {
    return linear > 0 ? 1 / linear : null;
  }

  const discriminant = linear * linear + 4 * quadratic;
  if (discriminant < 0) return null;

  const rootA = (-linear + Math.sqrt(discriminant)) / (2 * quadratic);
  const rootB = (-linear - Math.sqrt(discriminant)) / (2 * quadratic);
  const positiveRoots = [rootA, rootB].filter((root) => root > 0);

  return positiveRoots.length > 0 ? Math.min(...positiveRoots) : null;
}

export function calculateTsaiWuFailure(input: TsaiWuInput) {
  const { stress, strengths, interactionCoefficient } = input;
  const f1 = 1 / strengths.xtMPa - 1 / strengths.xcMPa;
  const f2 = 1 / strengths.ytMPa - 1 / strengths.ycMPa;
  const f11 = 1 / (strengths.xtMPa * strengths.xcMPa);
  const f22 = 1 / (strengths.ytMPa * strengths.ycMPa);
  const f66 = 1 / (strengths.s12MPa * strengths.s12MPa);
  const f12 = interactionCoefficient * Math.sqrt(f11 * f22);
  const linear = f1 * stress.sigma1MPa + f2 * stress.sigma2MPa;
  const quadratic =
    f11 * stress.sigma1MPa ** 2 +
    f22 * stress.sigma2MPa ** 2 +
    f66 * stress.tau12MPa ** 2 +
    2 * f12 * stress.sigma1MPa * stress.sigma2MPa;
  const failureIndex = linear + quadratic;
  const reserveFactor = solveTsaiWuReserveFactor(linear, quadratic);

  return {
    failureIndex: cleanNumber(failureIndex),
    reserveFactor: finiteReserveFactor(reserveFactor),
    coefficients: {
      f1: cleanNumber(f1),
      f2: cleanNumber(f2),
      f11: cleanNumber(f11),
      f22: cleanNumber(f22),
      f66: cleanNumber(f66),
      f12: cleanNumber(f12),
    },
  };
}

function matrixMagnitude(matrix: Matrix3) {
  return matrix.reduce(
    (sum, row) =>
      sum + row.reduce((rowSum, value) => rowSum + Math.abs(value), 0),
    0,
  );
}

function buildAngleSearchPlies(input: LayupAngleSearchInput, angleDeg: number) {
  const makePly = (angle: number): PlyDefinition => ({
    angleDeg: angle,
    thicknessMm: input.plyThicknessMm,
    materialName: input.materialName,
  });
  const halfStack: PlyDefinition[] = [];

  for (let index = 0; index < input.hoopPliesPerSide; index += 1) {
    halfStack.push(makePly(90));
  }
  for (let index = 0; index < input.anglePairRepeats; index += 1) {
    halfStack.push(makePly(angleDeg), makePly(-angleDeg));
  }
  for (let index = 0; index < input.hoopPliesPerSide; index += 1) {
    halfStack.push(makePly(90));
  }

  return input.mirrorSymmetric
    ? [...halfStack, ...halfStack.slice().reverse()]
    : halfStack;
}

export function searchLayupAngles(input: LayupAngleSearchInput) {
  const weights = {
    axialStiffness: 0.3,
    hoopStiffness: 1,
    shearStiffness: 0.2,
    couplingPenalty: 1,
    ...input.objectiveWeights,
  };

  const rawCandidates = input.angleCandidatesDeg.map((angleDeg) => {
    const plies = buildAngleSearchPlies(input, angleDeg);
    const abd = calculateLaminateAbd({ lamina: input.lamina, plies });
    const constants = abd.effectiveEngineeringConstants;
    const a = abd.aMatrixNPerMm;
    const b = abd.bMatrixN;
    const aMagnitude = matrixMagnitude(a);
    const inPlaneCouplingIndex =
      aMagnitude > 0 ? (Math.abs(a[0][2]) + Math.abs(a[1][2])) / aMagnitude : 0;
    const bendingCouplingIndex =
      aMagnitude > 0 && abd.totalThicknessMm > 0
        ? matrixMagnitude(b) / (aMagnitude * abd.totalThicknessMm)
        : 0;

    return {
      angleDeg: cleanNumber(angleDeg),
      plies,
      plyCount: plies.length,
      totalThicknessMm: abd.totalThicknessMm,
      effectiveEngineeringConstants: constants,
      inPlaneCouplingIndex: cleanNumber(inPlaneCouplingIndex),
      bendingCouplingIndex: cleanNumber(bendingCouplingIndex),
      layupSummary: summarizeLayup({ plies }),
    };
  });

  const maxAxial = Math.max(
    ...rawCandidates.map(
      (candidate) => candidate.effectiveEngineeringConstants.exGPa,
    ),
    1,
  );
  const maxHoop = Math.max(
    ...rawCandidates.map(
      (candidate) => candidate.effectiveEngineeringConstants.eyGPa,
    ),
    1,
  );
  const maxShear = Math.max(
    ...rawCandidates.map(
      (candidate) => candidate.effectiveEngineeringConstants.gxyGPa,
    ),
    1,
  );

  const candidates = rawCandidates
    .map((candidate) => {
      const constants = candidate.effectiveEngineeringConstants;
      const score =
        weights.axialStiffness * (constants.exGPa / maxAxial) +
        weights.hoopStiffness * (constants.eyGPa / maxHoop) +
        weights.shearStiffness * (constants.gxyGPa / maxShear) -
        weights.couplingPenalty *
          (candidate.inPlaneCouplingIndex + candidate.bendingCouplingIndex);

      return {
        ...candidate,
        score: cleanNumber(score),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.effectiveEngineeringConstants.eyGPa -
          a.effectiveEngineeringConstants.eyGPa ||
        a.angleDeg - b.angleDeg,
    );

  return {
    searchSpace: {
      candidateCount: input.angleCandidatesDeg.length,
      angleCandidatesDeg: input.angleCandidatesDeg.map(cleanNumber),
      plyThicknessMm: input.plyThicknessMm,
      anglePairRepeats: input.anglePairRepeats,
      hoopPliesPerSide: input.hoopPliesPerSide,
      mirrorSymmetric: input.mirrorSymmetric,
    },
    objectiveWeights: weights,
    best: candidates[0],
    candidates: candidates.slice(0, input.topK),
  };
}

function candidateMetric(candidate: DesignScreeningCandidate, metric: string) {
  const value = candidate[metric as keyof DesignScreeningCandidate];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`候选方案 ${candidate.id} 缺少数值指标：${metric}`);
  }
  return value;
}

function isDominated(
  candidate: DesignScreeningCandidate,
  challenger: DesignScreeningCandidate,
  objectives: ScreeningObjective[],
) {
  let hasStrictlyBetterMetric = false;
  for (const objective of objectives) {
    const currentValue = candidateMetric(candidate, objective.metric);
    const challengerValue = candidateMetric(challenger, objective.metric);
    const isBetterOrEqual =
      objective.direction === "maximize"
        ? challengerValue >= currentValue
        : challengerValue <= currentValue;
    const isStrictlyBetter =
      objective.direction === "maximize"
        ? challengerValue > currentValue
        : challengerValue < currentValue;

    if (!isBetterOrEqual) return false;
    if (isStrictlyBetter) hasStrictlyBetterMetric = true;
  }
  return hasStrictlyBetterMetric;
}

export function screenDesignCandidates(input: MultiObjectiveScreeningInput) {
  const objectiveRanges = input.objectives.map((objective) => {
    const values = input.candidates.map((candidate) =>
      candidateMetric(candidate, objective.metric),
    );
    return {
      ...objective,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  });
  const totalWeight = input.objectives.reduce(
    (sum, objective) => sum + objective.weight,
    0,
  );

  const ranked = input.candidates
    .map((candidate) => {
      const objectiveValues = objectiveRanges.map((objective) => {
        const value = candidateMetric(candidate, objective.metric);
        const span = objective.max - objective.min;
        const normalized =
          span === 0
            ? 1
            : objective.direction === "maximize"
            ? (value - objective.min) / span
            : (objective.max - value) / span;
        return {
          metric: objective.metric,
          direction: objective.direction,
          weight: objective.weight,
          value: cleanNumber(value),
          normalized: cleanNumber(normalized),
        };
      });
      const weightedScore =
        objectiveValues.reduce(
          (sum, objective) => sum + objective.normalized * objective.weight,
          0,
        ) / totalWeight;
      const paretoEfficient = !input.candidates.some(
        (challenger) =>
          challenger.id !== candidate.id &&
          isDominated(candidate, challenger, input.objectives),
      );

      return {
        ...candidate,
        objectiveValues,
        score: cleanNumber(weightedScore),
        paretoEfficient,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    objectives: objectiveRanges.map((objective) => ({
      metric: objective.metric,
      direction: objective.direction,
      weight: objective.weight,
      min: cleanNumber(objective.min),
      max: cleanNumber(objective.max),
    })),
    ranked: ranked.slice(0, input.topK),
    paretoEfficientIds: ranked
      .filter((candidate) => candidate.paretoEfficient)
      .map((candidate) => candidate.id),
  };
}
