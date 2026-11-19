import type { RagEvidence, RagEvidenceReference } from "../utils/rag-evidence";

export function RagEvidenceReferenceView({
  evidence,
}: {
  evidence: RagEvidenceReference;
}) {
  return (
    <dl style={{ overflowWrap: "anywhere", fontSize: 12 }}>
      <dt>来源记录</dt>
      <dd>{evidence.record_id}</dd>
      <dt>分块</dt>
      <dd>{evidence.chunk_id}</dd>
      <dt>指纹</dt>
      <dd>{evidence.chunk_fingerprint}</dd>
    </dl>
  );
}

// 证据详情保留原始条件和列投影，展示身份与服务端采用的分块一致。
export function RagEvidenceView({ evidence }: { evidence: RagEvidence }) {
  return (
    <details
      data-testid="knowledge-evidence"
      style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: 12 }}
    >
      <summary>证据：{evidence.title || "文献（未提供题名）"}</summary>
      <RagEvidenceReferenceView evidence={evidence} />
      <p>
        {evidence.evidence_kind} / {evidence.evidence_usage}
      </p>
      {evidence.applicability_context.length > 0 && (
        <div>
          <strong>适用条件原文</strong>
          {evidence.applicability_context.map((condition, index) => (
            <p key={index} style={{ whiteSpace: "pre-wrap" }}>
              {condition}
            </p>
          ))}
        </div>
      )}
      {evidence.table_evidence.length > 0 && (
        <details>
          <summary>表格列与投影</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(evidence.table_evidence, null, 2)}
          </pre>
        </details>
      )}
      <p style={{ whiteSpace: "pre-wrap" }}>{evidence.text}</p>
    </details>
  );
}
