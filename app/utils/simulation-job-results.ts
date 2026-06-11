export const SIMULATION_JOB_DRAFTS_HEADER = "x-csgpt-simulation-job-drafts";

export type SimulationJobDraft = {
  id: string;
  title: string;
  solver: "calculix" | "abaqus" | "ansys" | "comsol" | "custom";
  summary: string;
  input: {
    geometry?: Record<string, number | string>;
    load?: Record<string, number | string>;
    material?: Record<string, string>;
    layup?: string;
    boundaryConditions?: string[];
    mesh?: Record<string, number | string>;
    outputs: string[];
    missingFields: string[];
  };
};

const MAX_HEADER_VALUE_LENGTH = 7600;

export function encodeSimulationJobDraftsHeader(drafts: SimulationJobDraft[]) {
  if (!drafts.length) return "";
  const encode = (items: SimulationJobDraft[]) =>
    encodeURIComponent(JSON.stringify(items));

  const encoded = encode(drafts);
  if (encoded.length <= MAX_HEADER_VALUE_LENGTH) return encoded;

  for (let count = drafts.length; count > 0; count -= 1) {
    const compactEncoded = encode(drafts.slice(0, count));
    if (compactEncoded.length <= MAX_HEADER_VALUE_LENGTH) {
      return compactEncoded;
    }
  }
  return "";
}

export function parseSimulationJobDraftsHeader(response?: Response) {
  const value = response?.headers?.get(SIMULATION_JOB_DRAFTS_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? (parsed as SimulationJobDraft[]) : [];
  } catch {
    return [];
  }
}
