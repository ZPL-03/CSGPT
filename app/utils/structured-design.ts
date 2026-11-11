export const CSGPT_DESIGN_ARTIFACT_FIELD = "csgpt_design_artifact";
export const CSGPT_DESIGN_ARTIFACT_CHUNK_FIELD = "csgpt_design_artifact_chunk";
export const CSGPT_DESIGN_ARTIFACT_HEADER = "x-csgpt-design-artifact";

export type CSGPTDesignArtifact = {
  status: "passed";
  generation_mode: string;
  contract_version?: string;
  engine_version?: number;
  engine_fingerprint?: string;
  result: Record<string, unknown>;
};

export type CSGPTDesignArtifactSummary = {
  generation_mode: string;
  candidate_count: number;
  design_fingerprint: string;
};

export type CSGPTDesignArtifactChunk = {
  id: string;
  index: number;
  total: number;
  data: string;
};

export function toCSGPTDesignArtifact(response: Record<string, unknown>) {
  const { markdown: _markdown, ...artifact } = response;
  return artifact as CSGPTDesignArtifact;
}

export function summarizeCSGPTDesignArtifact(
  artifact: CSGPTDesignArtifact,
): CSGPTDesignArtifactSummary {
  const result = artifact.result || {};
  return {
    generation_mode: artifact.generation_mode,
    candidate_count:
      typeof result.candidate_count === "number" ? result.candidate_count : 0,
    design_fingerprint:
      typeof result.design_fingerprint === "string"
        ? result.design_fingerprint
        : "",
  };
}

export function encodeCSGPTDesignArtifactHeader(artifact: CSGPTDesignArtifact) {
  return encodeURIComponent(
    JSON.stringify(summarizeCSGPTDesignArtifact(artifact)),
  );
}

export function parseCSGPTDesignArtifactHeader(response?: Response) {
  const value = response?.headers?.get(CSGPT_DESIGN_ARTIFACT_HEADER);
  if (!value) return null;
  try {
    return JSON.parse(decodeURIComponent(value)) as CSGPTDesignArtifactSummary;
  } catch {
    return null;
  }
}

export function validateCSGPTDesignArtifact(
  value: unknown,
  expected?: CSGPTDesignArtifactSummary | null,
): CSGPTDesignArtifact {
  const artifact = value as CSGPTDesignArtifact | undefined;
  if (
    artifact?.status !== "passed" ||
    typeof artifact.generation_mode !== "string" ||
    !artifact.result ||
    typeof artifact.result !== "object"
  ) {
    throw new Error("结构化设计合同缺失或结构无效。");
  }
  const summary = summarizeCSGPTDesignArtifact(artifact);
  const candidates = artifact.result.candidates;
  if (
    !Number.isInteger(summary.candidate_count) ||
    summary.candidate_count < 1 ||
    !Array.isArray(candidates) ||
    candidates.length !== summary.candidate_count ||
    !summary.design_fingerprint ||
    (expected &&
      (summary.generation_mode !== expected.generation_mode ||
        summary.candidate_count !== expected.candidate_count ||
        summary.design_fingerprint !== expected.design_fingerprint))
  ) {
    throw new Error("结构化设计合同的候选数量、指纹或生成模式不一致。");
  }
  return artifact;
}

export class CSGPTDesignArtifactAssembler {
  private id: string | null = null;
  private total = 0;
  private parts = new Map<number, string>();

  get started() {
    return this.id !== null;
  }

  accept(chunk: CSGPTDesignArtifactChunk): CSGPTDesignArtifact | undefined {
    if (
      !chunk ||
      typeof chunk.id !== "string" ||
      !chunk.id ||
      !Number.isInteger(chunk.index) ||
      !Number.isInteger(chunk.total) ||
      chunk.index < 0 ||
      chunk.total <= 0 ||
      chunk.index >= chunk.total ||
      typeof chunk.data !== "string" ||
      !chunk.data
    ) {
      throw new Error("结构化设计合同分片无效。");
    }
    if (this.id === null) {
      this.id = chunk.id;
      this.total = chunk.total;
    }
    if (
      this.id !== chunk.id ||
      this.total !== chunk.total ||
      this.parts.has(chunk.index)
    ) {
      throw new Error("结构化设计合同分片的标识、总数或编号冲突。");
    }
    this.parts.set(chunk.index, chunk.data);
    if (this.parts.size !== this.total) return;
    const serialized = Array.from({ length: this.total }, (_, index) =>
      this.parts.get(index),
    ).join("");
    return validateCSGPTDesignArtifact(JSON.parse(serialized));
  }
}
