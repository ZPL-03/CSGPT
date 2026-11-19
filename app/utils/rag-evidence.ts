import { z } from "zod";
import { assessRagQuality } from "./rag-quality";

const text = z.string().refine((value) => value.trim().length > 0);
const fingerprint = z.string().regex(/^[a-f0-9]{40}$/);
const indexes = z.array(z.number().int().nonnegative());
const kind = z.enum([
  "text",
  "conditional",
  "definition",
  "approximation",
  "table",
  "formula",
]);
const usage = z.enum(["reference", "source_conditions_only"]);

const tableSchema = z
  .object({
    headers: z.array(text).min(1),
    numeric_columns: indexes,
    structure_issues: z.array(text).length(0),
    identifier_columns: indexes,
    dimensionless_columns: indexes,
    missing_header_columns: indexes.length(0),
    missing_unit_columns: indexes.length(0),
    table_role: z.enum(["material_properties", "result_table", "other"]),
    condition_required: z.boolean(),
    condition_columns: z.record(z.string(), indexes),
    condition_context_present: z.boolean(),
    condition_context: z.array(text),
    usage: z.literal("source_conditions_only"),
    column_projection: z
      .object({
        source_chunk_id: text,
        source_chunk_fingerprint: fingerprint,
        source_column_indices: indexes,
        excluded_columns: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            header: z.string(),
            issues: z.array(text),
          }),
        ),
      })
      .optional(),
  })
  .passthrough()
  .refine((table) => {
    const columns = [
      ...table.numeric_columns,
      ...table.identifier_columns,
      ...table.dimensionless_columns,
      ...Object.values(table.condition_columns).flat(),
    ];
    if (columns.some((index) => index >= table.headers.length)) return false;
    if (table.condition_required && !table.condition_context_present)
      return false;
    const projection = table.column_projection;
    if (!projection) return true;
    return (
      projection.source_column_indices.length === table.headers.length &&
      new Set(projection.source_column_indices).size === table.headers.length &&
      projection.excluded_columns.every(
        (column) => !projection.source_column_indices.includes(column.index),
      )
    );
  });

const metadataSchema = z.object({
  content_quality_version: z.literal("3"),
  content_quality_issues: z.array(z.string()).length(0),
  retrieval_eligible: z.literal(true),
  record_id: text,
  chunk_id: text,
  chunk_fingerprint: fingerprint,
  evidence_kind: kind,
  evidence_usage: usage,
  applicability_context: z.array(text),
  table_evidence: z.array(tableSchema),
});

export type RagEvidenceMetadata = z.infer<typeof metadataSchema>;
export type RagEvidenceReference = Pick<
  RagEvidenceMetadata,
  "record_id" | "chunk_id" | "chunk_fingerprint"
>;
export type RagEvidence = RagEvidenceMetadata & {
  text: string;
  title: string;
  sourceUrl?: string;
};

/** 当前运行包的证据契约；缺少资格、身份或条件字段时不作为可检索证据。 */
export function parseRagEvidenceMetadata(
  value: unknown,
): RagEvidenceMetadata | null {
  const parsed = metadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function evidenceReference(
  evidence: RagEvidenceReference,
): RagEvidenceReference {
  return {
    record_id: evidence.record_id,
    chunk_id: evidence.chunk_id,
    chunk_fingerprint: evidence.chunk_fingerprint,
  };
}

export function evidenceScopeKey(
  value: Pick<
    RagEvidenceMetadata,
    "evidence_kind" | "evidence_usage" | "applicability_context"
  >,
) {
  return JSON.stringify([
    value.evidence_kind,
    value.evidence_usage,
    value.applicability_context,
  ]);
}

/** 正文与条件原文共同检查；表格元数据仅绑定相同表头的列。 */
export function isUsableRagEvidence(
  text: string,
  metadata: RagEvidenceMetadata,
) {
  return (
    assessRagQuality(text, Infinity, metadata.table_evidence).usable &&
    [
      ...metadata.applicability_context,
      ...metadata.table_evidence.flatMap((table) => table.condition_context),
    ].every((condition) => assessRagQuality(condition, Infinity).usable)
  );
}

/** 模型看到的引用单元包含全部条件和列投影，不截断原文或公式。 */
export function formatRagEvidence(evidence: RagEvidence) {
  return [
    `分块标识：${evidence.chunk_id}`,
    `分块指纹：${evidence.chunk_fingerprint}`,
    `证据类型：${evidence.evidence_kind}`,
    `使用范围：${evidence.evidence_usage}`,
    "适用条件原文：",
    ...evidence.applicability_context,
    ...evidence.table_evidence.flatMap((table, index) =>
      table.condition_context.length
        ? [`表格 ${index + 1} 适用条件原文：`, ...table.condition_context]
        : [],
    ),
    `表格证据与列投影：${JSON.stringify(evidence.table_evidence)}`,
    `内容：${evidence.text}`,
  ].join("\n");
}
