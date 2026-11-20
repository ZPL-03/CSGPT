import {
  validateDesignContract,
  type DesignServiceResponse,
  type FEMReadyDesignServiceResponse,
  type DeterministicDesignServiceResponse,
} from "./design-contract";
import type { CSGPTDesignArtifact } from "./structured-design";
import { lastUserMessageText } from "./server-message-content";

type ArtifactMessage = {
  role?: string;
  isError?: boolean;
  streaming?: boolean;
  designArtifact?: CSGPTDesignArtifact;
};

/** 工件只取自当前上下文中已经完成的消息，不用模型文字重建候选。 */
export function latestDesignArtifact(
  messages: ArtifactMessage[],
  clearContextIndex = 0,
) {
  return messages
    .slice(clearContextIndex)
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        !message.isError &&
        !message.streaming &&
        message.designArtifact,
    )?.designArtifact;
}

export function angleDistribution(sequence: number[]) {
  const counts = new Map<number, number>();
  for (const angle of sequence) counts.set(angle, (counts.get(angle) || 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a - b)
    .map(([angle_deg, ply_count]) => ({
      angle_deg,
      ply_count,
      fraction: ply_count / sequence.length,
    }));
}

/** 有工件时按生成模式规范编号；无工件时保留用户的显式编号形式。 */
export function requestedDesignIds(
  text: string,
  generationMode?: DesignServiceResponse["generation_mode"],
) {
  const ids = [
    ...[...text.matchAll(/TMP[_\s-]?(\d+)/gi)].map(
      (match) => `TMP_${Number(match[1])}`,
    ),
    ...[
      ...text.matchAll(/(?:候选|方案)\s*(?:编号)?\s*(\d+)|第\s*(\d+)\s*组/g),
    ].map((match) => String(Number(match[1] || match[2]))),
  ];
  return [
    ...new Set(
      ids.map((id) => {
        const number = id.replace(/^TMP_/, "");
        if (generationMode === "fem_ready_cylindrical_shell")
          return `TMP_${number}`;
        if (generationMode === "concept_layup_enumeration") return number;
        return id;
      }),
    ),
  ];
}

export function buildDesignFacts(
  response: DesignServiceResponse,
  selectedIds: string[] = [],
) {
  // 只展开点名候选；共用层序字典，完整工件仍随请求传输并独立校验。
  const sequences: number[][] = [];
  const selected = response.result.candidates.filter((item) =>
    selectedIds.includes(String(item.candidate_id)),
  );
  if (selected.length !== selectedIds.length)
    throw new Error("请求的候选编号不在当前设计工件中。");
  const candidates = selected.map((item) => {
    const fem =
      response.generation_mode === "fem_ready_cylindrical_shell"
        ? (item as FEMReadyDesignServiceResponse["result"]["candidates"][number])
        : null;
    const concept =
      item as DeterministicDesignServiceResponse["result"]["candidates"][number];
    const angles = fem ? fem.layup.angles_deg : concept.layup_deg;
    let sequenceIndex = sequences.findIndex(
      (value) =>
        value.length === angles.length &&
        value.every((angle, i) => angle === angles[i]),
    );
    if (sequenceIndex < 0) sequenceIndex = sequences.push(angles) - 1;
    return {
      candidate_id: item.candidate_id,
      design_revision_id: item.design_revision_id,
      sequence_index: sequenceIndex,
      layer_count: angles.length,
      ply_thickness_mm: fem
        ? fem.layup.ply_thickness_mm
        : concept.ply_thickness_mm,
      total_thickness_mm: fem
        ? fem.geometry.thickness_mm
        : concept.total_thickness_mm,
      symmetric: fem ? fem.layup.symmetric : concept.symmetric,
      balanced: fem ? fem.layup.balanced : concept.balanced,
      material: fem ? fem.material_system : concept.material,
      parameters: fem ? fem.geometry : concept.parameters,
      screening: fem
        ? fem.screening
        : {
            current_abaqus_status: "not_run",
            current_design_verdict: "pending",
          },
      historical_fem_reference: fem
        ? fem.provenance.historical_fem_reference
        : null,
      source: fem
        ? {
            source_row_number: fem.provenance.source_row_number,
            source_sha256: fem.provenance.source_sha256,
            source_geometry: fem.provenance.source_geometry,
            geometry_match: fem.provenance.geometry_match,
          }
        : null,
    };
  });
  return {
    design_fingerprint: response.result.design_fingerprint,
    generation_mode: response.generation_mode,
    candidate_count: response.result.candidate_count,
    candidate_ids: response.result.candidates.map((item) => item.candidate_id),
    request: response.result.request,
    calculated_facts: response.interpretation_context.facts,
    input_provenance: response.input_provenance ?? null,
    sequences: sequences.map((angles_deg) => ({
      angles_deg,
      actual_angle_distribution: angleDistribution(angles_deg),
    })),
    candidates,
  };
}

export const DESIGN_FACT_RULES =
  "工件字段是候选事实，历史自然语言解释不能覆盖它。用户未指定的输入不等于工具未生成：所有候选已有完整物理层序和层数，只有 null 字段仍未确定。" +
  "允许角度是搜索约束，实际角度与比例以工件中的层序及逐层统计为准。" +
  "not_run 表示未求解，pending 表示尚未判定；既不表示达到安全阈值，也不表示未达到安全阈值。历史参考不是当前结果。";

export function designArtifactMessage(
  artifact: CSGPTDesignArtifact,
  question = "",
) {
  const validated = validateDesignContract(artifact);
  return {
    role: "developer" as const,
    _csgptContextPriority: 95,
    _csgptContextAtomic: true,
    designArtifact: artifact,
    content: `${DESIGN_FACT_RULES}汇总覆盖所有候选，candidates 与 sequences 仅展开当前问题点名的候选；未展开不等于未生成。\n${JSON.stringify(
      buildDesignFacts(
        validated,
        requestedDesignIds(question, validated.generation_mode),
      ),
    )}`,
  };
}

/** 服务端重新检查浏览器携带的合同，拒绝失效工件而不是回退到上一条回答。 */
export function bindDesignArtifactMessages(messages: any[]) {
  const carriers = messages.filter(
    (message) => message.designArtifact !== undefined,
  );
  if (carriers.length > 1)
    throw new Error("每次追问只能绑定一个当前设计工件。");
  const question = lastUserMessageText(messages);
  return messages.map((message) =>
    message.designArtifact === undefined
      ? message
      : designArtifactMessage(message.designArtifact, question),
  );
}
