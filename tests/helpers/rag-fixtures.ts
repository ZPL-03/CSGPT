import { createHash } from "node:crypto";

// 合成分块仅用于消费合同与页面证据检查，不代表工程资料。
export function ragChunk(
  id = "fixture-chunk",
  overrides: Record<string, unknown> = {},
) {
  return {
    record_id: "fixture-record",
    chunk_id: id,
    chunk_fingerprint: createHash("sha1").update(id).digest("hex"),
    content_quality_version: "3",
    content_quality_issues: [],
    retrieval_eligible: true,
    evidence_kind: "conditional",
    evidence_usage: "source_conditions_only",
    applicability_context: [
      "仅适用于同一材料与厚度关于中面对称的层合板；弯扭耦合是否可忽略需要另外比较。",
    ],
    table_evidence: [],
    document_title: "合成层合板证据",
    content_markdown:
      "Cylindrical Shell under External Pressure: laminate buckling depends on its geometry, layup, loading and boundary conditions. This synthetic reference is not a solved pressure hull or a verified allowable load.",
    ...overrides,
  };
}

export function ragRelation(
  chunk: ReturnType<typeof ragChunk>,
  overrides: Record<string, unknown> = {},
) {
  return {
    source: "Cylindrical Shell",
    source_type: "Structure",
    relation: "UNDER_LOAD",
    target: "External Pressure",
    target_type: "LoadCase",
    record_id: chunk.record_id,
    evidence_chunk_id: chunk.chunk_id,
    evidence_chunk_fingerprint: chunk.chunk_fingerprint,
    evidence_kind: chunk.evidence_kind,
    evidence_usage: chunk.evidence_usage,
    applicability_context: chunk.applicability_context,
    ...overrides,
  };
}

export const tableChunk = ragChunk("fixture-table", {
  evidence_kind: "table",
  content_markdown:
    "合成材料参数，供列投影与单位绑定检验，不用于当前结构承载结论。材料表的泊松比列为无量纲，弹性模量列使用表头给定的 GPa。\n\n| 材料 | E1/GPa | E2/GPa | nu12 |\n| --- | --- | --- | --- |\n| Fixture | 135 | 9 | 0.3 |",
  table_evidence: [
    {
      headers: ["材料", "E1/GPa", "E2/GPa", "nu12"],
      numeric_columns: [1, 2, 3],
      structure_issues: [],
      identifier_columns: [0],
      dimensionless_columns: [3],
      missing_header_columns: [],
      missing_unit_columns: [],
      table_role: "material_properties",
      condition_required: false,
      condition_columns: { material: [0] },
      condition_context_present: true,
      condition_context: ["合成材料参数。"],
      usage: "source_conditions_only",
      column_projection: {
        source_chunk_id: "fixture-original-table",
        source_chunk_fingerprint: "a".repeat(40),
        source_column_indices: [0, 1, 3, 4],
        excluded_columns: [
          { index: 2, header: "未知列", issues: ["table_units_missing"] },
        ],
      },
    },
  ],
});
