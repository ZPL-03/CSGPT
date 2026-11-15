type LaminateCandidate = {
  candidateId: string;
  sequence: number[];
  declaredSymmetric: boolean | null;
  declaredBalanced: boolean | null;
};

type SymmetryMismatch = {
  first_layer: number;
  first_angle: number;
  mirror_layer: number;
  mirror_angle: number;
};

type LaminateServiceCase = {
  case_id: string;
  layer_count: number;
  sequence_deg: number[];
  angle_sequence_symmetric: boolean;
  angle_count_balanced: boolean;
  calculated_coupling: Record<string, number> | null;
  symmetry_mismatch: SymmetryMismatch | null;
};

type LaminateServiceResponse = {
  status: string;
  contract_version: string;
  calculation_mode: string;
  engine_version: number;
  engine_fingerprint: string;
  calculation_fingerprint: string;
  result: {
    schema_version: string;
    calculation_mode: string;
    reference_plane: string;
    layer_order: string;
    coupling_units: { A: string; B: string; D: string };
    cases: LaminateServiceCase[];
  };
};

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function splitMarkdownRow(line: string) {
  if (!line.trim().startsWith("|")) return [];
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseBooleanCell(value: string | undefined): boolean | null {
  if (!value) return null;
  if (/^(是|true|yes)$/i.test(value.trim())) return true;
  if (/^(否|false|no)$/i.test(value.trim())) return false;
  return null;
}

function parseSequence(value: string | undefined) {
  if (!value) return [];
  const sequence = value
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/°/g, "");
  if (
    !/^[-+]?\d+(?:\.\d+)?(?:\s*[,，/、]\s*[-+]?\d+(?:\.\d+)?)*$/.test(sequence)
  )
    return [];
  return sequence.split(/[,，/、]/).map(Number);
}

function extractEmbeddedJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseStructuredCandidates(text: string): LaminateCandidate[] {
  const root = extractEmbeddedJson(text) as {
    result?: { candidates?: unknown[] };
    candidates?: unknown[];
  } | null;
  const candidates = root?.result?.candidates || root?.candidates;
  if (!Array.isArray(candidates)) return [];

  return candidates.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as {
      candidate_id?: unknown;
      layup?: { angles_deg?: unknown; symmetric?: unknown; balanced?: unknown };
    };
    const candidateId = String(candidate.candidate_id || "").toUpperCase();
    const angles = candidate.layup?.angles_deg;
    if (!/^TMP_\d+$/i.test(candidateId) || !Array.isArray(angles)) {
      return [];
    }
    if (
      angles.some(
        (angle) => typeof angle !== "number" || !Number.isFinite(angle),
      )
    )
      return [];
    const sequence = angles as number[];
    if (!sequence.length) return [];
    const parsed: LaminateCandidate = {
      candidateId,
      sequence,
      declaredSymmetric:
        typeof candidate.layup?.symmetric === "boolean"
          ? candidate.layup.symmetric
          : null,
      declaredBalanced:
        typeof candidate.layup?.balanced === "boolean"
          ? candidate.layup.balanced
          : null,
    };
    return [parsed];
  });
}

function parseCandidates(text: string): LaminateCandidate[] {
  const lines = text.split(/\r?\n/);
  let headers: string[] | null = null;
  const candidates: LaminateCandidate[] = [];
  for (const line of lines) {
    const cells = splitMarkdownRow(line);
    if (cells.some((cell) => /显式铺层|铺层.*外到内/i.test(cell))) {
      headers = cells;
      continue;
    }
    const candidateId = cells[0]?.match(/^TMP_\d+$/i)?.[0].toUpperCase();
    if (!candidateId || !headers || cells.length !== headers.length) continue;
    const sequenceIndex = headers.findIndex((header) =>
      /显式铺层|铺层.*外到内/i.test(header),
    );
    const symmetricIndex = headers.findIndex((header) => /对称/i.test(header));
    const balancedIndex = headers.findIndex((header) => /均衡/i.test(header));
    const sequence = parseSequence(cells[sequenceIndex]);
    if (!sequence.length) continue;
    candidates.push({
      candidateId,
      sequence,
      declaredSymmetric: parseBooleanCell(cells[symmetricIndex]),
      declaredBalanced: parseBooleanCell(cells[balancedIndex]),
    });
  }
  return candidates.length ? candidates : parseStructuredCandidates(text);
}

function latestUserText(messages: any[]) {
  const message = messages.at(-1);
  return message?.role === "user" ? normalizeContent(message.content) : "";
}

function latestCandidateContext(messages: any[]) {
  const messageTexts = [...messages]
    .reverse()
    .map((message) => normalizeContent(message?.content));
  return (
    messageTexts.find(
      (text) =>
        (/\|\s*TMP_\d+\s*\|/i.test(text) &&
          /(?:显式铺层|铺层.*外到内)/i.test(text)) ||
        (/"candidates"\s*:\s*\[/i.test(text) && /"angles_deg"\s*:/i.test(text)),
    ) || ""
  );
}

export function detectLaminateAnalysisIntent(messages: any[]) {
  const text = latestUserText(messages);
  if (!text) return false;
  const explicitlyAvoidsGeneration =
    /(?:不要|无需|不必|不再|勿).{0,12}(?:生成|输出|枚举)/i.test(text);
  if (
    !explicitlyAvoidsGeneration &&
    /(?:生成|输出|枚举).{0,12}(?:候选|方案)|(?:候选|方案).{0,12}(?:生成|输出|枚举)/i.test(
      text,
    )
  ) {
    return false;
  }
  const laminateQuestion =
    /(?:ABD|层合|铺层|laminate|layup|对称|均衡|symmetric|balanced|B\s*矩阵)/i.test(
      text,
    );
  return (
    laminateQuestion &&
    (extractEmbeddedJson(text) !== null ||
      requestedCandidateIds(text).length > 0)
  );
}

function requestedCandidateIds(text: string) {
  return [
    ...new Set(
      [...text.matchAll(/TMP[_\s-]?(\d+)/gi)].map((match) => `TMP_${match[1]}`),
    ),
  ];
}

function formatAngle(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(6)}°`;
}

function candidateResult(
  candidate: LaminateCandidate,
  result: LaminateServiceCase,
) {
  const declared =
    candidate.declaredSymmetric === null || candidate.declaredBalanced === null
      ? "未提供完整布尔字段"
      : `表中字段 symmetric=${candidate.declaredSymmetric}, balanced=${candidate.declaredBalanced}`;
  const mismatch = result.symmetry_mismatch
    ? `首个镜像不一致为第 ${
        result.symmetry_mismatch.first_layer
      } 层 ${formatAngle(result.symmetry_mismatch.first_angle)} 与第 ${
        result.symmetry_mismatch.mirror_layer
      } 层 ${formatAngle(result.symmetry_mismatch.mirror_angle)}`
    : "每一层与中面镜像层一致";
  return `- ${candidate.candidateId}：${candidate.sequence.length} 层；角度序列对称=${result.angle_sequence_symmetric}，正负角层数均衡=${result.angle_count_balanced}；${declared}；${mismatch}。`;
}

function designServiceBaseUrl() {
  return String(
    process.env.CSGPT_CS2_DESIGN_BASE_URL ||
      process.env.CSGPT_CS2_BASE_URL ||
      "",
  ).replace(/\/+$/, "");
}

async function requestLaminateService(
  payload: LaminatePayload,
): Promise<LaminateServiceResponse> {
  const configuredBaseUrl = designServiceBaseUrl();
  if (!configuredBaseUrl) throw new Error("CS2 层合板计算服务地址未配置。");
  const baseUrl = configuredBaseUrl.endsWith("/v1")
    ? configuredBaseUrl
    : `${configuredBaseUrl}/v1`;
  const response = await fetch(`${baseUrl}/design/laminate-stiffness`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.CSGPT_CS2_DESIGN_API_KEY || process.env.CSGPT_CS2_API_KEY
        ? {
            Authorization: `Bearer ${
              process.env.CSGPT_CS2_DESIGN_API_KEY ||
              process.env.CSGPT_CS2_API_KEY
            }`,
          }
        : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response
    .json()
    .catch(() => null)) as LaminateServiceResponse | null;
  if (!response.ok || !data) {
    throw new Error(`层合板计算服务返回 HTTP ${response.status}。`);
  }
  if (
    data.status !== "passed" ||
    data.contract_version !== "2" ||
    !/^[a-f0-9]{64}$/.test(data.engine_fingerprint) ||
    !/^[a-f0-9]{64}$/.test(data.calculation_fingerprint) ||
    !Number.isInteger(data.engine_version) ||
    data.calculation_mode !== payload.calculation_mode ||
    data.result?.schema_version !== "2" ||
    data.result.calculation_mode !== payload.calculation_mode ||
    data.result.reference_plane !== "geometric_midplane" ||
    data.result.layer_order !== "negative_z_to_positive_z" ||
    data.result.coupling_units?.A !== "N/mm" ||
    data.result.coupling_units?.B !== "N" ||
    data.result.coupling_units?.D !== "N*mm" ||
    !Array.isArray(data.result.cases) ||
    data.result.cases.length !== payload.cases.length
  ) {
    throw new Error("层合板计算服务返回的结构化合同无效。");
  }
  for (const [index, item] of data.result.cases.entries()) {
    const input = payload.cases[index];
    const numeric = payload.calculation_mode === "laminate_abd_coupling";
    if (
      !item ||
      typeof item !== "object" ||
      item.case_id !== input.case_id ||
      item.layer_count !== input.layers.length ||
      !Array.isArray(item.sequence_deg) ||
      item.sequence_deg.length !== input.layers.length ||
      item.sequence_deg.some(
        (angle, i) => angle !== input.layers[i].angle_deg,
      ) ||
      typeof item.angle_sequence_symmetric !== "boolean" ||
      typeof item.angle_count_balanced !== "boolean" ||
      (numeric
        ? !item.calculated_coupling ||
          ["A16", "A26", "B16", "B26", "D16", "D26"].some(
            (key) =>
              typeof item.calculated_coupling?.[key] !== "number" ||
              !Number.isFinite(item.calculated_coupling[key]),
          )
        : item.calculated_coupling !== null)
    )
      throw new Error("层合板计算结果与请求的截面、层序或数值字段不一致。");
    const mismatch = item.symmetry_mismatch;
    if (item.angle_sequence_symmetric) {
      if (mismatch !== null) throw new Error("对称层序的镜像校核证据不一致。");
    } else if (
      !mismatch ||
      !Number.isInteger(mismatch.first_layer) ||
      mismatch.first_layer < 1 ||
      mismatch.first_layer > Math.floor(item.layer_count / 2) ||
      mismatch.mirror_layer !== item.layer_count + 1 - mismatch.first_layer ||
      mismatch.first_angle !== item.sequence_deg[mismatch.first_layer - 1] ||
      mismatch.mirror_angle !== item.sequence_deg[mismatch.mirror_layer - 1] ||
      mismatch.first_angle === mismatch.mirror_angle
    ) {
      throw new Error("非对称层序的镜像校核证据不一致。");
    }
  }
  return data;
}

type LaminateLayer = {
  angle_deg: number;
  thickness_mm?: number;
  Qbar16_MPa?: number;
  Qbar26_MPa?: number;
};
type LaminatePayload = {
  schema_version: string;
  calculation_mode: string;
  cases: {
    case_id: string;
    layers: LaminateLayer[];
    material?: Record<string, number>;
  }[];
};

function buildSemanticsPayload(
  candidates: LaminateCandidate[],
): LaminatePayload {
  return {
    schema_version: "2",
    calculation_mode: "laminate_layup_semantics",
    cases: candidates.map((candidate) => ({
      case_id: candidate.candidateId,
      layers: candidate.sequence.map((angle) => ({ angle_deg: angle })),
    })),
  };
}

function extractNumericCases(text: string) {
  const root = extractEmbeddedJson(text) as any;
  if (
    root &&
    "cases" in root &&
    (!Array.isArray(root.cases) || !root.cases.length)
  )
    throw new Error("cases 必须是非空数组。");
  const rawCases = Array.isArray(root?.cases)
    ? root.cases
    : Array.isArray(root?.result?.cases)
    ? root.result.cases
    : root && typeof root === "object"
    ? Object.entries(root)
        .filter(
          ([, value]) =>
            value &&
            typeof value === "object" &&
            Array.isArray((value as any).layers),
        )
        .map(([case_id, value]) => ({ case_id, ...(value as object) }))
    : [];
  if (!Array.isArray(rawCases) || !rawCases.length) return [];
  const finite = (value: unknown, field: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`${field} 必须是有限数值。`);
    return value;
  };
  const caseIds = new Set<string>();
  return rawCases.map((rawCase: any, index: number) => {
    if (!rawCase || typeof rawCase !== "object")
      throw new Error("层合板截面必须是对象。");
    const caseId = String(
      rawCase?.case_id || rawCase?.id || `截面${index + 1}`,
    );
    if (!caseId.trim() || caseIds.has(caseId))
      throw new Error("截面编号必须非空且唯一。");
    caseIds.add(caseId);
    let layers = Array.isArray(rawCase?.layers) ? rawCase.layers : [];
    if (
      layers.length &&
      (rawCase.sequence_deg || rawCase.Qbar16_MPa || rawCase.Qbar26_MPa)
    ) {
      throw new Error("layers 与截面级层序、Qbar 数组不得同时提供。");
    }
    if (!layers.length && Array.isArray(rawCase?.sequence_deg)) {
      for (const key of ["ply_thicknesses_mm", "Qbar16_MPa", "Qbar26_MPa"]) {
        if (
          rawCase[key] !== undefined &&
          (!Array.isArray(rawCase[key]) ||
            rawCase[key].length !== rawCase.sequence_deg.length)
        ) {
          throw new Error(`${key} 必须与层序等长。`);
        }
      }
      if (
        rawCase.ply_thicknesses_mm !== undefined &&
        rawCase.ply_thickness_mm !== undefined
      )
        throw new Error("逐层厚度与统一层厚不得同时提供。");
      const thicknesses = Array.isArray(rawCase.ply_thicknesses_mm)
        ? rawCase.ply_thicknesses_mm
        : rawCase.sequence_deg.map(() => rawCase.ply_thickness_mm);
      layers = rawCase.sequence_deg.map(
        (angle: unknown, layerIndex: number) => ({
          angle_deg: angle,
          thickness_mm: thicknesses[layerIndex],
          ...(Array.isArray(rawCase.Qbar16_MPa)
            ? { Qbar16_MPa: rawCase.Qbar16_MPa[layerIndex] }
            : {}),
          ...(Array.isArray(rawCase.Qbar26_MPa)
            ? { Qbar26_MPa: rawCase.Qbar26_MPa[layerIndex] }
            : {}),
        }),
      );
    }
    if (!layers.length || layers.length > 200)
      throw new Error("每个截面必须包含 1 到 200 层。");
    let material: Record<string, number> | undefined;
    if (rawCase.material !== undefined) {
      if (!rawCase.material || typeof rawCase.material !== "object")
        throw new Error("material 必须是对象。");
      material = Object.fromEntries(
        ["E1_GPa", "E2_GPa", "G12_GPa", "nu12"].map((key) => [
          key,
          finite(rawCase.material[key], key),
        ]),
      );
    }
    return {
      case_id: caseId,
      ...(material ? { material } : {}),
      layers: layers.map((layer: any) => {
        if (!layer || typeof layer !== "object")
          throw new Error("物理层必须是对象。");
        const thickness = finite(layer.thickness_mm, "thickness_mm");
        if (thickness <= 0) throw new Error("单层厚度必须大于零。");
        if (
          material &&
          (layer.Qbar16_MPa !== undefined || layer.Qbar26_MPa !== undefined)
        )
          throw new Error("material 与逐层 Qbar 不得同时提供。");
        return {
          angle_deg: finite(layer.angle_deg, "angle_deg"),
          thickness_mm: thickness,
          ...(!material
            ? {
                Qbar16_MPa: finite(layer.Qbar16_MPa, "Qbar16_MPa"),
                Qbar26_MPa: finite(layer.Qbar26_MPa, "Qbar26_MPa"),
              }
            : {}),
        };
      }),
    };
  });
}

function numericPayload(text: string): LaminatePayload | null {
  const cases = extractNumericCases(text);
  if (!cases.length) return null;
  if (cases.length > 100) throw new Error("截面数量不得超过 100。");
  return {
    schema_version: "2",
    calculation_mode: "laminate_abd_coupling",
    cases,
  };
}

function renderNumericResult(response: LaminateServiceResponse) {
  const cases = response.result.cases;
  const lines = cases.map((item) => {
    const values = item.calculated_coupling!;
    return `#### ${item.case_id}\n- 物理层数：${
      item.layer_count
    }；逐层序列：${item.sequence_deg.map(formatAngle).join("、")}\n- A16=${
      values.A16
    } N/mm，A26=${values.A26} N/mm；B16=${values.B16} N，B26=${
      values.B26
    } N；D16=${values.D16} N·mm，D26=${values.D26} N·mm。`;
  });
  return `### 层合板耦合项计算结果\n\n计算引擎 v${
    response.engine_version
  }；计算指纹 ${
    response.calculation_fingerprint
  }。参考面为几何中面，层序从负 z 到正 z；A、B、D 分别使用 1、z、z² 权重积分。
层内 Qbar 为常量时，各项为：Aij = Σ Qbar_ij,k (z_k-z_(k-1))；Bij = (1/2) Σ Qbar_ij,k (z_k²-z_(k-1)²)；Dij = (1/3) Σ Qbar_ij,k (z_k³-z_(k-1)³)。Qbar 使用 MPa，z 使用 mm。
单一均匀层以自身中面为参考时，Aij=Qbar_ij h，Bij=0，Dij=Qbar_ij h³/12；多层截面使用各层上下表面的坐标求和。
计算范围为六个耦合项，不含完整刚度矩阵或壳体承载结果。对称性由材料、角度和厚度的中面镜像关系判定；浮点残差应按单位、刚度量级和计算精度评价，不能仅因小量非零断言层序不对称。\n\n${lines.join(
    "\n\n",
  )}`;
}

export async function buildLaminateCalculationContext(
  messages: any[],
): Promise<string | null> {
  if (!detectLaminateAnalysisIntent(messages)) return null;
  const userText = latestUserText(messages);
  const numeric = numericPayload(userText);
  if (numeric) {
    return renderNumericResult(await requestLaminateService(numeric));
  }
  const candidates = parseCandidates(latestCandidateContext(messages));
  const requestedIds = requestedCandidateIds(userText);
  const selected = requestedIds.length
    ? candidates.filter((candidate) =>
        requestedIds.includes(candidate.candidateId),
      )
    : [];
  if (!requestedIds.length) return null;
  if (selected.length !== requestedIds.length)
    throw new Error("请求的候选缺少可核对的完整物理层序列。");
  const service = await requestLaminateService(buildSemanticsPayload(selected));
  return `### 层序核对结果\n\n${selected
    .map((candidate, index) =>
      candidateResult(candidate, service.result.cases[index]),
    )
    .join(
      "\n",
    )}\n\n角度序列对称和正负层数均衡不包含材料、厚度的配对判定；不能仅据此判定 B 矩阵或 D16/D26。`;
}
