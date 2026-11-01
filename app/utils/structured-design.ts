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
