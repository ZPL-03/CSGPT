import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  parseRagEvidenceMetadata,
  isUsableRagEvidence,
  formatRagEvidence,
} from "../app/utils/rag-evidence";
import {
  countRagKgDocumentSources,
  encodeRagKgSourcesHeader,
  groupRagKgDocumentSources,
  parseRagKgSourcesHeader,
  RAG_KG_SOURCES_HEADER,
} from "../app/utils/rag-kg-sources";
import { applyCSGPTContextBudget } from "../app/utils/csgpt-context-budget";
import { ragChunk, ragRelation, tableChunk } from "./helpers/rag-fixtures";

const require = createRequire(import.meta.url);

test("证据契约保留身份、条件及列投影，拒绝禁用或不完整元数据", () => {
  const row = ragChunk();
  const metadata = parseRagEvidenceMetadata(row)!;
  assert.equal(metadata.chunk_fingerprint, row.chunk_fingerprint);
  assert.deepEqual(metadata.applicability_context, row.applicability_context);
  for (const patch of [
    { retrieval_eligible: false },
    { retrieval_eligible: "true" },
    { applicability_context: undefined },
    { chunk_fingerprint: "stale" },
    { content_quality_issues: ["formula_missing"] },
    { evidence_usage: "review_required" },
    { content_quality_version: "2" },
    { content_quality_version: 3 },
  ])
    assert.equal(parseRagEvidenceMetadata({ ...row, ...patch }), null);
  const table = parseRagEvidenceMetadata(tableChunk)!;
  assert.deepEqual(table.table_evidence, tableChunk.table_evidence);
  assert.ok(isUsableRagEvidence(tableChunk.content_markdown, table));
  const mismatched = structuredClone(table);
  mismatched.table_evidence[0].headers[3] = "其他列";
  assert.equal(
    isUsableRagEvidence(tableChunk.content_markdown, mismatched),
    false,
  );
  const projected = structuredClone(table);
  projected.table_evidence[0].column_projection!.source_column_indices[0] = 2;
  assert.equal(parseRagEvidenceMetadata(projected), null);
});

test("v3 表格结构问题必须完整且为空，顶层可检索标记不覆盖表头冲突", () => {
  const valid = parseRagEvidenceMetadata(tableChunk)!;
  assert.deepEqual(valid.table_evidence[0].structure_issues, []);
  for (const issues of [
    undefined,
    null,
    "table_header_alignment_ambiguous",
    ["table_header_alignment_ambiguous"],
    ["table_row_width_inconsistent"],
    ["unknown_structure_issue"],
    [1],
    [""],
  ]) {
    const row = structuredClone(tableChunk);
    (row.table_evidence as Record<string, unknown>[])[0].structure_issues =
      issues;
    assert.equal(parseRagEvidenceMetadata(row), null);
  }
  assert.ok(
    formatRagEvidence({
      ...valid,
      title: tableChunk.document_title,
      text: tableChunk.content_markdown,
    }).includes('"structure_issues":[]'),
  );
});

test("完整证据通过引用头传输与共享窗口，不从中间裁剪公式或条件", () => {
  const evidence = {
    ...parseRagEvidenceMetadata(tableChunk)!,
    text: tableChunk.content_markdown,
    title: tableChunk.document_title,
  };
  const content = formatRagEvidence(evidence);
  for (const condition of evidence.applicability_context)
    assert.ok(content.includes(condition));
  assert.ok(content.includes(JSON.stringify(evidence.table_evidence)));
  const messages = [
    { role: "system", content, _csgptContextAtomic: true },
    { role: "user", content: "核对证据" },
  ];
  const retained = applyCSGPTContextBudget(
    messages,
    { max_tokens: 100 },
    16000,
  );
  assert.equal(retained.messages[0].content, content);
  assert.throws(
    () =>
      applyCSGPTContextBudget(
        [{ ...messages[0], content: content.repeat(100) }, messages[1]],
        { max_tokens: 100 },
        1024,
      ),
    /超出|不足/,
  );
  const sources = [
    {
      kind: "document" as const,
      id: "S1",
      title: evidence.title,
      evidence: {
        record_id: evidence.record_id,
        chunk_id: evidence.chunk_id,
        chunk_fingerprint: evidence.chunk_fingerprint,
      },
    },
  ];
  const header = encodeRagKgSourcesHeader(sources);
  assert.deepEqual(
    parseRagKgSourcesHeader(
      new Response(null, { headers: { [RAG_KG_SOURCES_HEADER]: header } }),
    ),
    sources,
  );
});

test("同一来源的多个证据分块只显示一个来源项并保留分块编号", () => {
  const sources = [
    {
      kind: "document" as const,
      id: "S1",
      title: "同一篇资料",
      evidence: {
        record_id: "record-1",
        chunk_id: "chunk-1",
        chunk_fingerprint: "a".repeat(40),
      },
    },
    {
      kind: "document" as const,
      id: "S2",
      title: "同一篇资料",
      evidence: {
        record_id: "record-1",
        chunk_id: "chunk-2",
        chunk_fingerprint: "b".repeat(40),
      },
    },
    {
      kind: "document" as const,
      id: "S3",
      title: "另一篇资料",
      evidence: {
        record_id: "record-2",
        chunk_id: "chunk-3",
        chunk_fingerprint: "c".repeat(40),
      },
    },
  ];
  const groups = groupRagKgDocumentSources(sources);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].ids, ["S1", "S2"]);
  assert.deepEqual(
    groups[0].evidence.map((item) => item.chunk_id),
    ["chunk-1", "chunk-2"],
  );
  assert.equal(countRagKgDocumentSources(sources), 2);
});

// 子进程使用独立临时语料根目录，正式 data/csllm 始终只读。
async function retrieve(
  chunks: ReturnType<typeof ragChunk>[],
  relations: ReturnType<typeof ragRelation>[],
  stats = "{}",
) {
  const output = path.resolve("output");
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(path.join(output, "rag-contract-"));
  try {
    const data = path.join(root, "data/csllm");
    await mkdir(path.join(data, "runtime"), { recursive: true });
    await mkdir(path.join(data, "kg"), { recursive: true });
    for (const [name, rows] of [
      ["rag_chunks", chunks],
      ["relations", relations],
    ] as const) {
      await writeFile(
        path.join(data, `runtime/${name}.compact.jsonl.gz`),
        gzipSync(rows.map((row) => JSON.stringify(row)).join("\n")),
      );
    }
    await writeFile(path.join(data, "kg/entities.jsonl"), "");
    await writeFile(path.join(data, "kg/kg_stats.json"), stats);
    const moduleUrl = new URL("../app/utils/server-rag-kg.ts", import.meta.url)
      .href;
    const script = `const m=await import(${JSON.stringify(
      moduleUrl,
    )}); const messages=[{role:'user',content:'Cylindrical Shell External Pressure laminate'}]; console.log(JSON.stringify({context:await m.buildInternalKnowledgeContext(messages),small:await m.buildInternalKnowledgeContext(messages,{maxChars:500}),graph:await m.queryKnowledgeGraph('Cylindrical Shell'),overview:await m.queryKnowledgeGraph('')}));`;
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        pathToFileURL(require.resolve("tsx")).href,
        "--input-type=module",
        "-e",
        script,
      ],
      { cwd: root, maxBuffer: 2_000_000 },
    );
    return JSON.parse(result.stdout);
  } finally {
    assert.equal(path.dirname(root), output);
    await rm(root, { recursive: true, force: true });
  }
}

test("实际检索与图谱概览绑定当前分块，失配和禁用证据均不可见", async () => {
  const first = ragChunk("first");
  const second = ragChunk("second", {
    applicability_context: [
      "第二组证据只适用于另一组边界条件，不能合并成无条件结论。",
    ],
  });
  const disabled = ragChunk("disabled", { retrieval_eligible: false });
  const previousVersion = ragChunk("previous-version", {
    content_quality_version: "2",
  });
  const misaligned = ragChunk("misaligned", {
    ...structuredClone(tableChunk),
    chunk_id: "misaligned",
    table_evidence: [
      {
        ...(tableChunk.table_evidence as Record<string, unknown>[])[0],
        structure_issues: ["table_header_alignment_ambiguous"],
      },
    ],
  });
  const result = await retrieve(
    [first, second, disabled, previousVersion, misaligned],
    [
      ragRelation(first),
      ragRelation(second),
      ragRelation(disabled),
      ragRelation(previousVersion),
      ragRelation(misaligned),
      ragRelation(first, {
        evidence_chunk_fingerprint: "a".repeat(40),
        target: "Stale",
      }),
      ragRelation(first, { evidence_chunk_id: "absent", target: "Missing" }),
      ragRelation(first, { record_id: "wrong-record", target: "WrongRecord" }),
      ragRelation(first, {
        applicability_context: [],
        target: "WrongCondition",
      }),
    ],
  );
  assert.equal(result.small, null);
  for (const graph of [result.graph, result.overview]) {
    assert.equal(graph.edges.length, 2);
    assert.deepEqual(
      new Set(graph.edges.map((edge: any) => edge.evidence.chunk_id)),
      new Set(["first", "second"]),
    );
    assert.ok(
      graph.edges.every(
        (edge: any) => edge.target === "LoadCase:External Pressure",
      ),
    );
  }
  for (const chunk of [first, second]) {
    const excerpt = result.context.excerpts.find(
      (item: any) => item.evidence.chunk_id === chunk.chunk_id,
    );
    assert.deepEqual(
      excerpt.evidence.applicability_context,
      chunk.applicability_context,
    );
    assert.equal(excerpt.evidence.chunk_fingerprint, chunk.chunk_fingerprint);
    assert.ok(
      result.context.message.includes(formatRagEvidence(excerpt.evidence)),
    );
  }
  assert.ok(
    result.context.sources.every((source: any) =>
      ["first", "second"].includes(source.evidence.chunk_id),
    ),
  );
});

test("KG 可引用未进入文本 top-k 的完整表格证据，统计文件损坏明确失败", async () => {
  const result = await retrieve(
    [tableChunk],
    [
      ragRelation(tableChunk),
      ragRelation(tableChunk, {
        evidence_chunk_id: "fixture-original-table",
        evidence_chunk_fingerprint: "a".repeat(40),
      }),
    ],
  );
  assert.equal(result.graph.edges.length, 1);
  assert.deepEqual(
    result.graph.edges[0].evidence.table_evidence,
    tableChunk.table_evidence,
  );
  assert.deepEqual(
    result.context.excerpts[0].evidence.table_evidence,
    tableChunk.table_evidence,
  );
  assert.ok(
    result.context.message.includes(JSON.stringify(tableChunk.table_evidence)),
  );
  await assert.rejects(
    retrieve([ragChunk()], [ragRelation(ragChunk())], "not-json"),
    /JSON|Unexpected token/,
  );
});

test("图谱候选上限不被同一三元组的重复证据占满", async () => {
  const repeated = Array.from({ length: 180 }, (_, index) =>
    ragChunk(`repeated-${index}`),
  );
  const alternatives = [
    ["FailureMode", "Buckling"],
    ["ManufacturingProcess", "Filament Winding"],
    ["Material", "Carbon Fiber"],
    ["Property", "Stiffness"],
    ["VerificationMethod", "Finite Element"],
    ["DesignVariable", "Thickness"],
  ];
  const distinct = alternatives.map((_, index) =>
    ragChunk(`distinct-${index}`),
  );
  const relations = [
    ...repeated.map((chunk) => ragRelation(chunk)),
    ...distinct.map((chunk, index) =>
      ragRelation(chunk, {
        relation: "RELATED_TO",
        target_type: alternatives[index][0],
        target: alternatives[index][1],
      }),
    ),
  ];
  const result = await retrieve([...repeated, ...distinct], relations);
  const expectedTargets = new Set([
    "LoadCase:External Pressure",
    ...alternatives.map(([type, label]) => `${type}:${label}`),
  ]);
  for (const graph of [result.graph, result.overview]) {
    assert.equal(graph.stats.matchedRelations, relations.length);
    assert.deepEqual(
      new Set(graph.edges.map((edge: any) => edge.target)),
      expectedTargets,
    );
    const repeatedEdges = graph.edges.filter(
      (edge: any) => edge.target === "LoadCase:External Pressure",
    );
    assert.ok(repeatedEdges.length > 1);
    assert.equal(
      new Set(repeatedEdges.map((edge: any) => edge.evidence.chunk_id)).size,
      repeatedEdges.length,
    );
    assert.equal(
      new Set(graph.edges.map((edge: any) => edge.id)).size,
      graph.edges.length,
    );
  }
});
