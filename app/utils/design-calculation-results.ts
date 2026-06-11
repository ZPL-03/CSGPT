import type { DesignCalculationType } from "./design-calculation-registry";

export const DESIGN_CALCULATION_RESULTS_HEADER = "x-csgpt-design-calculations";

export type DesignCalculationTrace = {
  id: string;
  type: DesignCalculationType;
  title: string;
  input: unknown;
  result: unknown;
};

const MAX_HEADER_VALUE_LENGTH = 7600;

export function encodeDesignCalculationResultsHeader(
  results: DesignCalculationTrace[],
) {
  if (!results.length) return "";
  const encode = (items: DesignCalculationTrace[]) =>
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

export function parseDesignCalculationResultsHeader(response?: Response) {
  const value = response?.headers?.get(DESIGN_CALCULATION_RESULTS_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? (parsed as DesignCalculationTrace[]) : [];
  } catch {
    return [];
  }
}
