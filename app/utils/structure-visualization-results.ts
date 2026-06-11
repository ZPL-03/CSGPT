export const STRUCTURE_VISUALIZATION_RESULTS_HEADER =
  "x-csgpt-structure-visualizations";

export type StructureVisualizationKind =
  | "cylindrical-shell"
  | "spherical-shell"
  | "laminate-section";

export type StructureDimension = {
  label: string;
  value: number;
  unit: string;
};

export type LaminateLayerVisual = {
  index: number;
  angleDeg: number;
  thicknessMm: number;
  materialName?: string;
};

export type StructureVisualizationTrace = {
  id: string;
  type: StructureVisualizationKind;
  title: string;
  summary: string;
  dimensions: StructureDimension[];
  geometry: {
    innerRadiusM?: number;
    outerRadiusM?: number;
    lengthM?: number;
    thicknessM?: number;
  };
  laminate?: {
    totalThicknessMm: number;
    layers: LaminateLayerVisual[];
  };
};

const MAX_HEADER_VALUE_LENGTH = 7600;

export function encodeStructureVisualizationResultsHeader(
  results: StructureVisualizationTrace[],
) {
  if (!results.length) return "";
  const encode = (items: StructureVisualizationTrace[]) =>
    encodeURIComponent(JSON.stringify(items));

  const encoded = encode(results);
  if (encoded.length <= MAX_HEADER_VALUE_LENGTH) return encoded;

  for (let count = results.length; count > 0; count -= 1) {
    const compactEncoded = encode(results.slice(0, count));
    if (compactEncoded.length <= MAX_HEADER_VALUE_LENGTH) {
      return compactEncoded;
    }
  }
  return "";
}

export function parseStructureVisualizationResultsHeader(response?: Response) {
  const value = response?.headers?.get(STRUCTURE_VISUALIZATION_RESULTS_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed)
      ? (parsed as StructureVisualizationTrace[])
      : [];
  } catch {
    return [];
  }
}
