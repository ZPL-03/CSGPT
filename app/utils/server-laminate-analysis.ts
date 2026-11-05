type LaminateCandidate = {
  candidateId: string;
  sequence: number[];
  declaredSymmetric: boolean | null;
  declaredBalanced: boolean | null;
  symmetric: boolean;
  balanced: boolean;
  mismatch?: {
    firstLayer: number;
    firstAngle: number;
    mirrorLayer: number;
    mirrorAngle: number;
  };
};

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function splitMarkdownRow(line: string) {
  if (!line.trim().startsWith("|")) return [];
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseBooleanCell(value: string | undefined): boolean | null {
  if (!value) return null;
  if (/^(是|true|yes)$/i.test(value.trim())) return true;
  if (/^(否|false|no)$/i.test(value.trim())) return false;
  return null;
}

function parseSequence(value: string | undefined) {
  if (!value) return [];
  return [...value.matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0]),
  );
}

function isSymmetric(sequence: number[]) {
  return (
    sequence.length > 0 &&
    sequence.every(
      (value, index) =>
        Math.abs(value - sequence[sequence.length - index - 1]) <= 1e-9,
    )
  );
}

function isBalanced(sequence: number[]) {
  const counts = new Map<number, number>();
  for (const value of sequence) {
    if (Math.abs(value) === 0 || Math.abs(value) === 90) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...new Set([...counts.keys()].map(Math.abs))].every(
    (magnitude) =>
      (counts.get(magnitude) || 0) === (counts.get(-magnitude) || 0),
  );
}

function findSymmetryMismatch(sequence: number[]) {
  for (let index = 0; index < Math.floor(sequence.length / 2); index += 1) {
    const mirrorIndex = sequence.length - index - 1;
    if (Math.abs(sequence[index] - sequence[mirrorIndex]) > 1e-9) {
      return {
        firstLayer: index + 1,
        firstAngle: sequence[index],
        mirrorLayer: mirrorIndex + 1,
        mirrorAngle: sequence[mirrorIndex],
      };
    }
  }
  return undefined;
}

function parseCandidates(text: string): LaminateCandidate[] {
  const lines = text.split(/\r?\n/);
  let headers: string[] | null = null;
  const candidates: LaminateCandidate[] = [];
  for (const line of lines) {
    const cells = splitMarkdownRow(line);
    if (cells.some((cell) => /显式铺层|铺层.*外到内/i.test(cell))) {
      headers = cells;
      continue;
    }
    const candidateId = cells[0]?.match(/^TMP_\d+$/i)?.[0];
    if (!candidateId || !headers || cells.length !== headers.length) continue;
    const sequenceIndex = headers.findIndex((header) =>
      /显式铺层|铺层.*外到内/i.test(header),
    );
    const symmetricIndex = headers.findIndex((header) => /对称/i.test(header));
    const balancedIndex = headers.findIndex((header) => /均衡/i.test(header));
    const sequence = parseSequence(cells[sequenceIndex]);
    if (!sequence.length) continue;
    const symmetric = isSymmetric(sequence);
    const balanced = isBalanced(sequence);
    candidates.push({
      candidateId,
      sequence,
      declaredSymmetric: parseBooleanCell(cells[symmetricIndex]),
      declaredBalanced: parseBooleanCell(cells[balancedIndex]),
      symmetric,
      balanced,
      mismatch: findSymmetryMismatch(sequence),
    });
  }
  return candidates;
}

function latestUserText(messages: any[]) {
  return normalizeContent(
    [...messages].reverse().find((message) => message?.role === "user")
      ?.content,
  );
}

function latestCandidateContext(messages: any[]) {
  const messageTexts = [...messages]
    .reverse()
    .map((message) => normalizeContent(message?.content));
  return messageTexts.find((text) => /\|\s*TMP_\d+\s*\|/.test(text)) || "";
}

export function detectLaminateAnalysisIntent(messages: any[]) {
  const text = latestUserText(messages);
  if (!text) return false;
  const explicitlyAvoidsGeneration =
    /(?:不要|无需|不必|不再|勿).{0,12}(?:生成|输出|枚举)/i.test(text);
  if (
    !explicitlyAvoidsGeneration &&
    /(?:生成|输出|枚举).{0,12}(?:候选|方案)|(?:候选|方案).{0,12}(?:生成|输出|枚举)/i.test(
      text,
    )
  ) {
    return false;
  }
  return /(?:A\s*[,、/]?\s*B\s*[,、/]?\s*D|ABD|层合板|铺层|laminate|layup|对称性|均衡性|symmetric|balanced|mirror|镜像|B\s*矩阵)/i.test(
    text,
  );
}

function requestedCandidateIds(text: string) {
  return [
    ...new Set(
      [...text.matchAll(/TMP[_\s-]?(\d+)/gi)].map((match) => `TMP_${match[1]}`),
    ),
  ];
}

function formatAngle(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(6)}°`;
}

function candidateResult(candidate: LaminateCandidate) {
  const declared =
    candidate.declaredSymmetric === null || candidate.declaredBalanced === null
      ? "未提供完整布尔字段"
      : `表中字段 symmetric=${candidate.declaredSymmetric}, balanced=${candidate.declaredBalanced}`;
  const mismatch = candidate.mismatch
    ? `首个镜像不一致为第 ${candidate.mismatch.firstLayer} 层 ${formatAngle(
        candidate.mismatch.firstAngle,
      )} 与第 ${candidate.mismatch.mirrorLayer} 层 ${formatAngle(
        candidate.mismatch.mirrorAngle,
      )}`
    : "每一层与中面镜像层一致";
  return `- ${candidate.candidateId}：${candidate.sequence.length} 层；逐层复算为 symmetric=${candidate.symmetric}, balanced=${candidate.balanced}；${declared}；${mismatch}。`;
}

export function buildDeterministicLaminateAnalysis(messages: any[]) {
  const userText = latestUserText(messages);
  const candidates = parseCandidates(latestCandidateContext(messages));
  const requestedIds = requestedCandidateIds(userText);
  const selected = requestedIds.length
    ? candidates.filter((candidate) =>
        requestedIds.includes(candidate.candidateId),
      )
    : candidates.slice(0, 3);
  const resultLines = selected.length
    ? selected.map(candidateResult).join("\n")
    : "- 当前会话未找到可复算的显式物理层序列；不能据此判断对称性、均衡性或任何 B 矩阵分量。";

  return `### 层合板确定性事实核验

本回答只依据当前会话中可见的逐层铺层序列复算，不把语言模型的概括当作结构事实。当前回答是层合板输入解释，不是当前 Abaqus 求解结果。

### 显式序列结果

${resultLines}

### ABD 结论边界

- 均衡性按非 0°/90° 角度的正负层数分别计数；在材料和厚度配对满足经典层合板假设时，它主要支持 A16/A26 等面内拉伸-剪切耦合项的消除趋势。均衡不等于中面对称。
- 对称性必须由物理层顺序逐层镜像证明。只有序列对称并且材料、厚度关于中面配对时，才可以说明整个 B 矩阵理论上为零。对称性或均衡性不能单独推出 D16/D26 的数值。
- 当前选中的候选若为 symmetric=false 且 balanced=true，只能说明“非对称但均衡”，不能推出 B=0、没有拉伸-弯曲耦合或已经满足安全要求。数值 A/B/D 还需要材料刚度、单层厚度、坐标约定和完整物理层序列复算；当前线上会话没有可靠提供的数值标为未知，不猜测。

### FEM 状态

上一轮候选中的历史表格值只用于来源筛选或源表刚度追溯；它们不是当前 Abaqus 结果。当前候选必须按 design_revision_id 进入 CSDM_cph 圆柱壳子模型，执行当前边界、初始缺陷、几何非线性、屈曲/塌陷、渐进损伤和收敛校核。金属封头、法兰、连接和整机安全性仍不在当前圆柱壳子模型结论内。`;
}
