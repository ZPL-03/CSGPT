export const CONTROLLED_TOOL_RECORDS_HEADER = "x-csgpt-controlled-tools";

export type ControlledToolStatus =
  | "completed"
  | "empty"
  | "queued"
  | "configured";

export type ControlledToolRecord = {
  id: string;
  type: "csgpt.controlled_tool";
  function: {
    name: string;
    arguments: string;
  };
  content: string;
  isError: false;
};

const MAX_HEADER_VALUE_LENGTH = 7600;

function normalizeCount(count: number) {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function createControlledToolRecord(input: {
  id: string;
  name: string;
  enabled: boolean;
  count: number;
  unit: string;
  status?: ControlledToolStatus;
  content?: string;
}) {
  if (!input.enabled) return null;

  const count = normalizeCount(input.count);
  const status: ControlledToolStatus =
    input.status || (count > 0 ? "completed" : "empty");
  const content =
    input.content ||
    (status === "completed"
      ? `命中 ${count} ${input.unit}`
      : status === "queued"
      ? `已创建 ${count} ${input.unit}`
      : status === "configured"
      ? `已配置 ${count} ${input.unit}`
      : `未命中可用${input.unit}`);

  return {
    id: input.id,
    type: "csgpt.controlled_tool",
    function: {
      name: input.name,
      arguments: JSON.stringify({
        enabled: true,
        status,
        count,
        unit: input.unit,
      }),
    },
    content,
    isError: false,
  } satisfies ControlledToolRecord;
}

export function encodeControlledToolRecordsHeader(
  records: ControlledToolRecord[],
) {
  if (!records.length) return "";
  const encode = (items: ControlledToolRecord[]) =>
    encodeURIComponent(JSON.stringify(items));

  const encoded = encode(records);
  if (encoded.length <= MAX_HEADER_VALUE_LENGTH) return encoded;

  for (let count = records.length; count > 0; count -= 1) {
    const compactEncoded = encode(records.slice(0, count));
    if (compactEncoded.length <= MAX_HEADER_VALUE_LENGTH) {
      return compactEncoded;
    }
  }
  return "";
}

export function parseControlledToolRecordsHeader(response?: Response) {
  const value = response?.headers?.get(CONTROLLED_TOOL_RECORDS_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? (parsed as ControlledToolRecord[]) : [];
  } catch {
    return [];
  }
}
