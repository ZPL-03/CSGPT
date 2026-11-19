export type RagQualityIssue =
  | "missing_formula"
  | "damaged_formula"
  | "missing_table_header"
  | "missing_table_unit"
  | "invalid_table_evidence"
  | "incomplete_context";

const UNIT =
  /(?:\b(?:[kMGTmun]?Pa|[kmun]?N|mm|cm|m|kg|g|s|K|Hz|J|W|deg|degrees?)\b|[°%‰]|无量纲|dimensionless|non[- ]?dimensional|ratio|比值|系数|指数|编号|序号|数量|层数|number|count|index|ID)/i;
const NUMERIC = /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/** 只识别可观测的解析缺陷，不把质量通过当成理论正确性证明。 */
export function assessRagQuality(
  text: string,
  maxChars = 7000,
  tableEvidence?: readonly {
    headers: string[];
    identifier_columns: number[];
    dimensionless_columns: number[];
  }[],
) {
  const issues = new Set<RagQualityIssue>();
  if (
    text.length > maxChars ||
    /(?:\[上下文.*截取\]|\[truncated\])/i.test(text) ||
    /[:：]\s*$/.test(text)
  )
    issues.add("incomplete_context");
  if (
    /(?:formula|equation|math)[-_ ](?:not[-_ ](?:decoded|parsed)|missing)|公式(?:未解析|缺失)|\[公式\]/i.test(
      text,
    )
  )
    issues.add("missing_formula");
  if (/\uFFFD|_\s*\{\s*_|\\(?:frac|sqrt)\s*(?:$|[。；])/m.test(text))
    issues.add("damaged_formula");
  for (const [open, close] of [
    ["\\[", "\\]"],
    ["\\(", "\\)"],
  ]) {
    if (text.split(open).length !== text.split(close).length)
      issues.add("damaged_formula");
  }
  const environments = [...text.matchAll(/\\(begin|end)\{([^}]+)\}/g)];
  const stack: string[] = [];
  for (const [, type, name] of environments) {
    if (type === "begin") stack.push(name);
    else if (stack.pop() !== name) issues.add("damaged_formula");
  }
  if (stack.length) issues.add("damaged_formula");

  const lines = text.split(/\r?\n/);
  let tableIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    const table: string[][] = [];
    while (i < lines.length && lines[i].trim().startsWith("|"))
      table.push(cells(lines[i++]));
    i--;
    const header = table[0];
    const metadata = tableEvidence?.[tableIndex++];
    const metadataMatches =
      metadata && JSON.stringify(metadata.headers) === JSON.stringify(header);
    if (tableEvidence && !metadataMatches) issues.add("invalid_table_evidence");
    const separator = table[1]?.every((cell) => /^:?-{3,}:?$/.test(cell));
    if (
      !separator ||
      table.some((row) => row.length !== header.length) ||
      header.some((cell) => !cell)
    ) {
      issues.add("missing_table_header");
      continue;
    }
    for (let col = 0; col < header.length; col++) {
      const normalizedHeader = header[col]
        .replace(/\\[a-zA-Z]+|[${}]/g, "")
        .replace(/([a-zA-Z])\s+(?=[a-zA-Z])/g, "$1");
      const subheader = table[2]?.[col] || "";
      if (
        table.slice(2).some((row) => NUMERIC.test(row[col])) &&
        !UNIT.test(header[col]) &&
        !UNIT.test(normalizedHeader) &&
        !(
          metadataMatches &&
          (metadata.dimensionless_columns.includes(col) ||
            metadata.identifier_columns.includes(col))
        ) &&
        !(!NUMERIC.test(subheader) && UNIT.test(subheader))
      )
        issues.add("missing_table_unit");
    }
  }
  if (tableEvidence && tableIndex !== tableEvidence.length)
    issues.add("invalid_table_evidence");
  // 解析器输出的纯数字行失去了列语义，不能据此补单位或换算承载值。
  if (
    lines.filter(
      (line) =>
        /^\s*[-+]?\d[\d.eE+\-\s,;\t]+$/.test(line) &&
        line.trim().split(/[\s,;\t]+/).length >= 3,
    ).length >= 2
  ) {
    issues.add("missing_table_header");
  }
  return { usable: issues.size === 0, issues: [...issues] };
}
