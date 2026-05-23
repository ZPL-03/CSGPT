import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as zlib from "zlib";

type ChatMessageLike = {
  role?: string;
  content?: any;
};

type RagRow = {
  chunkId: string;
  recordId: string;
  title: string;
  pageStart?: number;
  pageEnd?: number;
  chunkType: string;
  searchText: string;
  text: string;
};

type ScoredRagRow = RagRow & {
  score: number;
};

type KgRelation = {
  source: string;
  sourceType: string;
  relation: string;
  target: string;
  targetType: string;
  recordId: string;
  score: number;
};

const DATA_ROOT = path.join(process.cwd(), "data", "csllm_cpv");
const RAG_CHUNKS_FILE = path.join(
  DATA_ROOT,
  "runtime",
  "rag_chunks.compact.jsonl.gz",
);
const KG_ENTITIES_FILE = path.join(DATA_ROOT, "kg", "entities.jsonl");
const KG_RELATIONS_FILE = path.join(
  DATA_ROOT,
  "runtime",
  "relations.compact.jsonl.gz",
);
const RAG_TOP_K = 5;
const KG_TOP_K = 12;
const MAX_CHUNK_TEXT_CHARS = 1800;
const MAX_SEARCH_TEXT_CHARS = 7000;
const MAX_CONTEXT_CHARS = 12000;

const DOMAIN_TERMS = [
  "composite pressure hull",
  "composite pressure vessel",
  "pressure hull",
  "pressure vessel",
  "external pressure",
  "hydrostatic pressure",
  "buckling pressure",
  "critical pressure",
  "ultimate strength",
  "filament winding",
  "winding angle",
  "laminated shell",
  "finite element",
  "复合材料",
  "耐压壳",
  "压力壳",
  "压力容器",
  "外压",
  "静水压力",
  "圆柱壳",
  "层合壳",
  "屈曲",
  "极限强度",
  "缠绕角",
  "铺层",
  "有限元",
  "制造",
];

const QUERY_SYNONYMS: Record<string, string[]> = {
  压力壳: ["pressure hull", "composite pressure hull", "hydrostatic pressure"],
  耐压壳: ["pressure hull", "composite pressure hull", "external pressure"],
  压力容器: ["pressure vessel", "composite pressure vessel", "COPV"],
  外压: ["external pressure", "hydrostatic pressure"],
  屈曲: ["buckling", "buckling pressure", "critical pressure"],
  极限强度: ["ultimate strength", "failure pressure"],
  缠绕: ["filament winding", "winding angle"],
  铺层: ["laminate", "laminated shell", "layup"],
  有限元: ["finite element", "FEA"],
  "pressure hull": ["composite pressure hull", "external pressure"],
  "pressure vessel": ["composite pressure vessel", "COPV"],
  buckling: ["buckling pressure", "critical pressure"],
};

let ragRowsPromise: Promise<RagRow[]> | null = null;
let kgEntityTermsPromise: Promise<string[]> | null = null;

function assertFileExists(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `外部 RAG/KG 数据缺失：${label} 不存在。请把数据迁移到 ${DATA_ROOT} 后再启用 RAG/KG。`,
    );
  }
}

function messageContentToText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  return content
    .map((item) => {
      if (!item || typeof item !== "object") return String(item ?? "");
      if (item.type === "text" || item.type === "input_text") {
        return item.text ?? item.content ?? "";
      }
      if (item.type === "file_url") {
        return item.file_url?.name ? `文件：${item.file_url.name}` : "";
      }
      if (item.type === "image_url") {
        return item.image_url?.name ? `图片：${item.image_url.name}` : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function lastUserMessage(messages: ChatMessageLike[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    const text = messageContentToText(message.content).trim();
    if (text) return text;
  }
  return "";
}

function trimText(text: string, limit: number) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit).trimEnd() + "...";
}

function tokenize(text: string): string[] {
  return (
    String(text || "")
      .toLowerCase()
      .match(/[a-zA-Z][a-zA-Z0-9_\-./]*|\d+(?:\.\d+)?|[\u4e00-\u9fff]/g) || []
  );
}

function expandQueryTerms(query: string): string[] {
  const queryLower = query.toLowerCase();
  const terms = new Set(tokenize(query));
  for (const term of DOMAIN_TERMS) {
    if (queryLower.includes(term.toLowerCase())) {
      terms.add(term.toLowerCase());
    }
  }
  for (const [key, values] of Object.entries(QUERY_SYNONYMS)) {
    if (queryLower.includes(key.toLowerCase())) {
      for (const value of values) terms.add(value.toLowerCase());
    }
  }
  return Array.from(terms).sort((a, b) => b.length - a.length);
}

function countHits(text: string, term: string) {
  if (!term) return 0;
  let hits = 0;
  let offset = 0;
  while (hits < 8) {
    const index = text.indexOf(term, offset);
    if (index < 0) break;
    hits += 1;
    offset = index + term.length;
  }
  return hits;
}

async function readJsonl(filePath: string, onRow: (row: any) => void) {
  const fileStream = fs.createReadStream(filePath);
  const stream = filePath.endsWith(".gz")
    ? fileStream.pipe(zlib.createGunzip())
    : fileStream;
  stream.setEncoding("utf-8");
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    try {
      onRow(JSON.parse(line));
    } catch {
      continue;
    }
  }
}

async function loadRagRows() {
  assertFileExists(RAG_CHUNKS_FILE, "runtime/rag_chunks.compact.jsonl.gz");
  const rows: RagRow[] = [];

  await readJsonl(RAG_CHUNKS_FILE, (chunk) => {
    const retrievalScope = String(chunk.retrieval_scope || "main");
    if (!["main", "mixed"].includes(retrievalScope)) return;

    const content = String(chunk.content_markdown || chunk.text || "");
    if (content.trim().length < 80) return;

    const title = String(chunk.title || "");
    const recordId = String(chunk.record_id || "");
    const metadata = [
      title,
      recordId,
      chunk.primary_category,
      (chunk.task_categories || []).join(" "),
      chunk.load_case_tag,
      (chunk.physics_quantities_mentioned || []).join(" "),
      chunk.design_platform_scope,
    ].join(" ");
    const contentPlain = String(
      chunk.content_search ||
        chunk.content_plain ||
        chunk.text ||
        chunk.content_markdown ||
        "",
    );

    rows.push({
      chunkId: String(chunk.chunk_id || ""),
      recordId,
      title,
      pageStart: Number(chunk.page_start ?? 0),
      pageEnd: Number(chunk.page_end ?? 0),
      chunkType: String(chunk.chunk_type || ""),
      searchText: `${metadata} ${contentPlain}`
        .toLowerCase()
        .slice(0, MAX_SEARCH_TEXT_CHARS),
      text: trimText(content, MAX_CHUNK_TEXT_CHARS),
    });
  });

  if (!rows.length) {
    throw new Error("外部 RAG 文本块为空，不能启用 RAG/KG。");
  }

  return rows;
}

async function getRagRows() {
  if (!ragRowsPromise) {
    ragRowsPromise = loadRagRows();
  }
  return ragRowsPromise;
}

async function loadKgEntityTerms() {
  assertFileExists(KG_ENTITIES_FILE, "kg/entities.jsonl");
  const terms = new Set<string>();
  await readJsonl(KG_ENTITIES_FILE, (entity) => {
    const name = String(entity.name || "")
      .trim()
      .toLowerCase();
    if (name) terms.add(name);
  });
  return Array.from(terms);
}

async function getKgEntityTerms() {
  if (!kgEntityTermsPromise) {
    kgEntityTermsPromise = loadKgEntityTerms();
  }
  return kgEntityTermsPromise;
}

async function searchRag(query: string, topK = RAG_TOP_K) {
  const rows = await getRagRows();
  const terms = expandQueryTerms(query);
  if (!terms.length) return [];

  const scored: ScoredRagRow[] = [];
  for (const row of rows) {
    let score = 0;
    for (const term of terms) {
      const hits = countHits(row.searchText, term);
      if (!hits) continue;
      score +=
        hits * (term.length === 1 ? 0.2 : 1 + Math.min(term.length, 24) / 8);
    }
    if (score > 0) scored.push({ ...row, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

async function searchKgRelations(
  query: string,
  recordIds: string[],
  topK = KG_TOP_K,
) {
  assertFileExists(KG_RELATIONS_FILE, "runtime/relations.compact.jsonl.gz");
  const recordSet = new Set(recordIds.filter(Boolean));
  const queryLower = query.toLowerCase();
  const expandedTerms = new Set(expandQueryTerms(query));
  const entityTerms = await getKgEntityTerms();
  for (const entity of entityTerms) {
    if (queryLower.includes(entity)) expandedTerms.add(entity);
  }

  const results: KgRelation[] = [];
  const seen = new Set<string>();
  await readJsonl(KG_RELATIONS_FILE, (relation) => {
    const source = String(relation.source || "");
    const target = String(relation.target || "");
    const recordId = String(relation.record_id || "");
    const relationType = String(relation.relation || "");
    const key = `${source}|${relationType}|${target}|${recordId}`;
    if (seen.has(key)) return;

    const sourceLower = source.toLowerCase();
    const targetLower = target.toLowerCase();
    let score = recordSet.has(recordId) ? 2 : 0;
    for (const term of expandedTerms) {
      if (!term || term.length < 2) continue;
      if (sourceLower.includes(term)) score += 2;
      if (targetLower.includes(term)) score += 2;
    }
    if (score <= 0) return;

    seen.add(key);
    results.push({
      source,
      sourceType: String(relation.source_type || ""),
      relation: relationType,
      target,
      targetType: String(relation.target_type || ""),
      recordId,
      score,
    });
  });

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function buildExternalRagKgSystemMessage(
  messages: ChatMessageLike[],
) {
  const query = lastUserMessage(messages);
  if (!query) return "";

  const chunks = await searchRag(query);
  const relations = await searchKgRelations(
    query,
    chunks.map((chunk) => chunk.recordId),
  );

  if (!chunks.length && !relations.length) {
    return "";
  }

  const contextParts: string[] = [];
  let usedChars = 0;
  chunks.forEach((chunk, index) => {
    const block = [
      `资料片段 ${index + 1}`,
      `标题：${chunk.title || "未命名资料"}`,
      `页码：${chunk.pageStart ?? ""}-${chunk.pageEnd ?? ""}`,
      `内容：${chunk.text}`,
    ].join("\n");
    if (usedChars + block.length <= MAX_CONTEXT_CHARS) {
      contextParts.push(block);
      usedChars += block.length;
    }
  });

  if (relations.length) {
    const relationText = relations
      .map(
        (item, index) =>
          `图谱关系 ${index + 1}：${item.source}(${item.sourceType}) -[${
            item.relation
          }]-> ${item.target}(${item.targetType})`,
      )
      .join("\n");
    contextParts.push(`知识图谱关系\n${relationText}`);
  }

  return [
    "本轮已启用外部 RAG/KG 增强。",
    "以下检索内容来自本项目内部数据，仅作为回答依据，不要在正文输出 chunk_id、record_id、内部路径或来源清单。",
    "如果检索内容不足，应说明缺少的工程参数，并给出可验证的设计、制造、仿真或试验分析路径。",
    "",
    `用户问题：${query}`,
    "",
    contextParts.join("\n\n"),
  ].join("\n");
}
