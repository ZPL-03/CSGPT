import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as zlib from "zlib";
import { normalizeKnowledgeGraphQuery } from "./knowledge-graph";
import type { RagKgSource } from "./rag-kg-sources";

type ChatMessageLike = {
  role?: string;
  content?: any;
};

type RagRow = {
  recordId: string;
  displayTitle: string;
  sourceUrl?: string;
  searchText: string;
  text: string;
};

type ScoredRagRow = RagRow & {
  score: number;
};

type KgEntity = {
  type: string;
  name: string;
  count: number;
  sources?: string[];
};

type KgRelation = {
  source: string;
  sourceType: string;
  relation: string;
  target: string;
  targetType: string;
  recordId: string;
  evidenceTitle?: string;
  evidenceUrl?: string;
  score: number;
};

export type KnowledgeGraphNode = {
  id: string;
  label: string;
  type: string;
  count: number;
  degree: number;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  recordId: string;
  score: number;
};

export type KnowledgeGraphQueryResult = {
  mode: "overview" | "query";
  query: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: {
    totalEntities: number;
    totalRelations: number;
    matchedRelations: number;
    returnedNodes: number;
    returnedEdges: number;
  };
};

const DATA_ROOT = path.join(process.cwd(), "data", "csllm");
const RAG_CHUNKS_FILE = path.join(
  DATA_ROOT,
  "runtime",
  "rag_chunks.compact.jsonl.gz",
);
const KG_ENTITIES_FILE = path.join(DATA_ROOT, "kg", "entities.jsonl");
const KG_STATS_FILE = path.join(DATA_ROOT, "kg", "kg_stats.json");
const KG_RELATIONS_FILE = path.join(
  DATA_ROOT,
  "runtime",
  "relations.compact.jsonl.gz",
);

const RAG_TOP_K = 5;
const KG_TOP_K = 12;
const GRAPH_EDGE_SCAN_LIMIT = 360;
const GRAPH_DEFAULT_NODE_LIMIT = 56;
const GRAPH_OVERVIEW_NODE_LIMIT = 48;
const GRAPH_MAX_QUERY_NODE_LIMIT = 72;
const GRAPH_MAX_OVERVIEW_NODE_LIMIT = 60;
const GRAPH_MAX_EDGES_PER_NODE = 4;
const MAX_CHUNK_TEXT_CHARS = 1800;
const MAX_SEARCH_TEXT_CHARS = 7000;
const MAX_CONTEXT_CHARS = 12000;
const MAX_VISIBLE_RAG_SOURCES = 5;
const MAX_VISIBLE_KG_SOURCES = 8;

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
  复合材料: ["composite material", "CFRP", "GFRP", "carbon fiber"],
  压力壳: ["pressure hull", "composite pressure hull", "hydrostatic pressure"],
  耐压壳: ["pressure hull", "composite pressure hull", "external pressure"],
  压力容器: ["pressure vessel", "composite pressure vessel", "COPV"],
  碳纤维: ["carbon fiber", "CFRP", "T700", "T800"],
  玻璃纤维: ["glass fiber", "GFRP"],
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
let kgEntitiesPromise: Promise<KgEntity[]> | null = null;
let kgEntityTermsPromise: Promise<string[]> | null = null;
let kgStatsPromise: Promise<{
  total_entities?: number;
  total_relations?: number;
}> | null = null;

function assertFileExists(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `外部 RAG/KG 数据缺失：${label} 不存在。请将数据放置到 ${DATA_ROOT} 后再启用 RAG/KG。`,
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

function cleanRagContent(value: string) {
  return String(value || "")
    .replace(
      /(^|\n)\s*#{1,3}\s*[a-f0-9]{20,}\.(pdf|docx?|pptx?|xlsx?)\s*/gi,
      "$1",
    )
    .replace(/\b[a-f0-9]{20,}\.(pdf|docx?|pptx?|xlsx?)\b/gi, "");
}

function isHashFileName(text: string) {
  return /^[a-f0-9]{20,}\.(pdf|docx?|pptx?|xlsx?)$/i.test(
    String(text || "").trim(),
  );
}

function startsWithHashFileName(text: string) {
  return /^[a-f0-9]{20,}\.(pdf|docx?|pptx?|xlsx?)\b/i.test(
    String(text || "").trim(),
  );
}

function cleanupTitleCandidate(value: string) {
  let title = String(value || "")
    .replace(/^#+\s*/, "")
    .replace(/^[a-f0-9]{20,}\.(pdf|docx?|pptx?|xlsx?)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^\d/.test(title)) return "";
  if (
    /^(abstract|introduction|conclusion|conclusions|references|keywords|figure|table)\b/i.test(
      title,
    )
  ) {
    return "";
  }

  title = title
    .replace(/\s+Abstract[:：].*$/i, "")
    .replace(/\s+摘要[:：].*$/i, "")
    .replace(/\s+###\s+.*$/g, "")
    .replace(/\s+A Thesis Submitted.*$/i, "")
    .replace(/\s+Submitted to.*$/i, "")
    .replace(/\s+Correspondence:.*$/i, "")
    .replace(/\s+Abstract[:：].*$/i, "")
    .replace(/\s+摘要[:：].*$/i, "")
    .replace(/\s+\d+(?:\.\d+)*\.?\s+Introduction.*$/i, "")
    .replace(
      /\s+[A-Z][A-Za-z'’.-]+\s+[A-Z][A-Za-z'’.-]+\s+\d(?:,\d+)*(?:,\*)?.*$/,
      "",
    )
    .trim();

  if (!title || isHashFileName(title)) return "";
  if (/^[a-f0-9]{20,}$/i.test(title)) return "";
  return trimText(title, 180);
}

function extractDisplayTitle(rawTitle: string, content: string) {
  const rawCandidate = cleanupTitleCandidate(rawTitle);
  if (rawCandidate && !isHashFileName(rawCandidate)) return rawCandidate;

  const headingMatches = Array.from(
    String(content || "").matchAll(/(#{1,3})\s+([^#\n\r]+)/g),
  );
  const rankedHeadings = [
    ...headingMatches.filter((match) => match[1] === "##"),
    ...headingMatches.filter((match) => match[1] === "###"),
    ...headingMatches.filter((match) => match[1] === "#"),
  ];
  for (const match of rankedHeadings) {
    const text = match[2] || "";
    if (startsWithHashFileName(text)) continue;
    const candidate = cleanupTitleCandidate(text);
    if (candidate) return candidate;
  }

  const rawFirstLine = String(content || "").split(/\r?\n/)[0];
  if (startsWithHashFileName(rawFirstLine.replace(/^#+\s*/, ""))) return "";
  const firstLine = cleanupTitleCandidate(rawFirstLine);
  return firstLine;
}

function normalizeTerm(text: string) {
  return String(text || "")
    .trim()
    .toLowerCase();
}

function tokenize(text: string): string[] {
  return (
    String(text || "")
      .toLowerCase()
      .match(/[a-zA-Z][a-zA-Z0-9_\-./]*|\d+(?:\.\d+)?|[\u4e00-\u9fff]{2,}/g) ||
    []
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

    const content = cleanRagContent(
      String(chunk.content_markdown || chunk.text || ""),
    );
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
      recordId,
      displayTitle: extractDisplayTitle(title, content),
      sourceUrl: String(chunk.source_url || ""),
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

async function loadKgEntities() {
  assertFileExists(KG_ENTITIES_FILE, "kg/entities.jsonl");
  const entities: KgEntity[] = [];
  await readJsonl(KG_ENTITIES_FILE, (entity) => {
    const name = String(entity.name || "").trim();
    if (!name) return;
    entities.push({
      type: String(entity.type || "Entity"),
      name,
      count: Number(entity.count || 0),
      sources: Array.isArray(entity.sources) ? entity.sources : [],
    });
  });
  return entities;
}

async function getKgEntities() {
  if (!kgEntitiesPromise) {
    kgEntitiesPromise = loadKgEntities();
  }
  return kgEntitiesPromise;
}

async function getKgEntityTerms() {
  if (!kgEntityTermsPromise) {
    kgEntityTermsPromise = getKgEntities().then((entities) =>
      entities.map((entity) => normalizeTerm(entity.name)),
    );
  }
  return kgEntityTermsPromise;
}

async function getKgStats() {
  if (!kgStatsPromise) {
    kgStatsPromise = fs.promises
      .readFile(KG_STATS_FILE, "utf-8")
      .then((content) => JSON.parse(content))
      .catch(() => ({}));
  }
  return kgStatsPromise;
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
  const expandedTerms = await getExpandedKgTerms(query);

  const results: KgRelation[] = [];
  const seen = new Set<string>();
  await readJsonl(KG_RELATIONS_FILE, (relation) => {
    const scored = scoreRelation(relation, expandedTerms, recordSet);
    if (!scored || scored.score <= 0) return;
    const key = `${scored.source}|${scored.relation}|${scored.target}|${scored.recordId}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(scored);
  });

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

async function getExpandedKgTerms(query: string) {
  const queryLower = normalizeTerm(query);
  const expandedTerms = new Set(expandQueryTerms(query));
  const entityTerms = await getKgEntityTerms();
  for (const entity of entityTerms) {
    if (entity && queryLower.includes(entity)) expandedTerms.add(entity);
  }
  return expandedTerms;
}

function scoreRelation(
  relation: any,
  expandedTerms: Set<string>,
  recordSet: Set<string>,
): KgRelation | null {
  const source = String(relation.source || "");
  const target = String(relation.target || "");
  const recordId = String(relation.record_id || "");
  const relationType = String(relation.relation || "");
  if (!source || !target || !relationType) return null;

  const sourceLower = normalizeTerm(source);
  const targetLower = normalizeTerm(target);
  const relationLower = normalizeTerm(relationType);
  let score = recordSet.has(recordId) ? 2 : 0;

  for (const term of expandedTerms) {
    if (!term || term.length < 2) continue;
    if (sourceLower.includes(term)) score += 2;
    if (targetLower.includes(term)) score += 2;
    if (relationLower.includes(term)) score += 1;
  }
  if (score <= 0) return null;

  return {
    source,
    sourceType: String(relation.source_type || ""),
    relation: relationType,
    target,
    targetType: String(relation.target_type || ""),
    recordId,
    evidenceTitle: String(relation.evidence_document_title || ""),
    evidenceUrl: String(relation.evidence_source_url || ""),
    score,
  };
}

function nodeId(type: string, label: string) {
  return `${type || "Entity"}:${label}`;
}

function relationKey(relation: KgRelation) {
  return `${relation.sourceType}:${relation.source}|${relation.relation}|${relation.targetType}:${relation.target}`;
}

function isVisualRelation(relation: any) {
  const sourceType = String(relation.source_type || "");
  const targetType = String(relation.target_type || "");
  const relationType = String(relation.relation || "");
  if (!sourceType || !targetType || !relationType) return false;
  if (sourceType === "Literature" || targetType === "Literature") return false;
  if (relationType === "CATEGORIZED_AS") return false;
  return true;
}

function relationToKgRelation(relation: any, score: number): KgRelation | null {
  const source = String(relation.source || "");
  const target = String(relation.target || "");
  const relationType = String(relation.relation || "");
  if (!source || !target || !relationType) return null;
  return {
    source,
    sourceType: String(relation.source_type || "Entity"),
    relation: relationType,
    target,
    targetType: String(relation.target_type || "Entity"),
    recordId: String(relation.record_id || ""),
    evidenceTitle: String(relation.evidence_document_title || ""),
    evidenceUrl: String(relation.evidence_source_url || ""),
    score,
  };
}

function buildGraphResult(
  mode: KnowledgeGraphQueryResult["mode"],
  query: string,
  relations: KgRelation[],
  entities: KgEntity[],
  stats: { total_entities?: number; total_relations?: number },
  nodeLimit: number,
  edgeLimit: number,
  matchedRelationCount: number,
): KnowledgeGraphQueryResult {
  const entityMap = new Map(
    entities.map((entity) => [normalizeTerm(entity.name), entity]),
  );
  const degree = new Map<string, number>();
  const nodeScores = new Map<string, number>();
  for (const relation of relations) {
    const sourceId = nodeId(relation.sourceType, relation.source);
    const targetId = nodeId(relation.targetType, relation.target);
    degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
    degree.set(targetId, (degree.get(targetId) || 0) + 1);
    nodeScores.set(sourceId, (nodeScores.get(sourceId) || 0) + relation.score);
    nodeScores.set(targetId, (nodeScores.get(targetId) || 0) + relation.score);
  }

  const candidateNodes = new Map<string, KnowledgeGraphNode>();
  for (const relation of relations) {
    for (const item of [
      { label: relation.source, type: relation.sourceType },
      { label: relation.target, type: relation.targetType },
    ]) {
      const id = nodeId(item.type, item.label);
      if (candidateNodes.has(id)) continue;
      const entity = entityMap.get(normalizeTerm(item.label));
      candidateNodes.set(id, {
        id,
        label: item.label,
        type: item.type || entity?.type || "Entity",
        count: entity?.count || 0,
        degree: degree.get(id) || 0,
      });
    }
  }

  const selectedNodeIds = new Set(
    Array.from(candidateNodes.values())
      .sort((a, b) => {
        const left =
          (nodeScores.get(a.id) || 0) + a.degree * 2 + Math.log1p(a.count);
        const right =
          (nodeScores.get(b.id) || 0) + b.degree * 2 + Math.log1p(b.count);
        return right - left;
      })
      .slice(0, nodeLimit)
      .map((node) => node.id),
  );
  const rankedNodes = Array.from(candidateNodes.values())
    .filter((node) => selectedNodeIds.has(node.id))
    .sort((a, b) => {
      const left =
        (nodeScores.get(a.id) || 0) + a.degree * 2 + Math.log1p(a.count);
      const right =
        (nodeScores.get(b.id) || 0) + b.degree * 2 + Math.log1p(b.count);
      return right - left;
    });
  const edges: KnowledgeGraphEdge[] = [];
  const edgeSeen = new Set<string>();
  const nodeEdgeCounts = new Map<string, number>();
  const rankedRelations = relations
    .slice()
    .sort(
      (a, b) =>
        b.score - a.score || relationKey(a).localeCompare(relationKey(b)),
    );
  for (const relation of rankedRelations) {
    const sourceId = nodeId(relation.sourceType, relation.source);
    const targetId = nodeId(relation.targetType, relation.target);
    if (!selectedNodeIds.has(sourceId) || !selectedNodeIds.has(targetId)) {
      continue;
    }
    const id = `${sourceId}|${relation.relation}|${targetId}`;
    if (edgeSeen.has(id)) continue;
    const sourceEdgeCount = nodeEdgeCounts.get(sourceId) || 0;
    const targetEdgeCount = nodeEdgeCounts.get(targetId) || 0;
    if (
      sourceEdgeCount >= GRAPH_MAX_EDGES_PER_NODE &&
      targetEdgeCount >= GRAPH_MAX_EDGES_PER_NODE
    ) {
      continue;
    }
    edgeSeen.add(id);
    nodeEdgeCounts.set(sourceId, sourceEdgeCount + 1);
    nodeEdgeCounts.set(targetId, targetEdgeCount + 1);
    edges.push({
      id,
      source: sourceId,
      target: targetId,
      relation: relation.relation,
      recordId: relation.recordId,
      score: relation.score,
    });
    if (edges.length >= edgeLimit) break;
  }
  const visibleNodeIds = new Set<string>();
  for (const edge of edges) {
    visibleNodeIds.add(edge.source);
    visibleNodeIds.add(edge.target);
  }
  const nodes = rankedNodes.filter(
    (node) => visibleNodeIds.has(node.id) || edges.length === 0,
  );

  return {
    mode,
    query,
    nodes,
    edges,
    stats: {
      totalEntities: Number(stats.total_entities || entities.length),
      totalRelations: Number(stats.total_relations || 0),
      matchedRelations: matchedRelationCount,
      returnedNodes: nodes.length,
      returnedEdges: edges.length,
    },
  };
}

async function queryKnowledgeGraphOverview(
  rawLimit: number,
): Promise<KnowledgeGraphQueryResult> {
  const nodeLimit = Math.max(
    28,
    Math.min(
      Number(rawLimit) || GRAPH_OVERVIEW_NODE_LIMIT,
      GRAPH_MAX_OVERVIEW_NODE_LIMIT,
    ),
  );
  const [entities, stats] = await Promise.all([getKgEntities(), getKgStats()]);
  const entityCounts = new Map(
    entities.map((entity) => [normalizeTerm(entity.name), entity.count || 1]),
  );
  const relationScores = new Map<string, KgRelation>();
  const nodeWeights = new Map<string, number>();

  await readJsonl(KG_RELATIONS_FILE, (relation) => {
    if (!isVisualRelation(relation)) return;
    const sourceCount = entityCounts.get(normalizeTerm(relation.source)) || 1;
    const targetCount = entityCounts.get(normalizeTerm(relation.target)) || 1;
    const score = Math.log1p(sourceCount) + Math.log1p(targetCount);
    const kgRelation = relationToKgRelation(relation, score);
    if (!kgRelation) return;
    const key = relationKey(kgRelation);
    const previous = relationScores.get(key);
    if (!previous || kgRelation.score > previous.score) {
      relationScores.set(key, kgRelation);
    }
    const sourceId = nodeId(kgRelation.sourceType, kgRelation.source);
    const targetId = nodeId(kgRelation.targetType, kgRelation.target);
    nodeWeights.set(sourceId, (nodeWeights.get(sourceId) || 0) + score);
    nodeWeights.set(targetId, (nodeWeights.get(targetId) || 0) + score);
  });

  const relations = Array.from(relationScores.values())
    .sort((a, b) => {
      const left =
        (nodeWeights.get(nodeId(a.sourceType, a.source)) || 0) +
        (nodeWeights.get(nodeId(a.targetType, a.target)) || 0) +
        a.score;
      const right =
        (nodeWeights.get(nodeId(b.sourceType, b.source)) || 0) +
        (nodeWeights.get(nodeId(b.targetType, b.target)) || 0) +
        b.score;
      return right - left;
    })
    .slice(0, nodeLimit * 2);

  return buildGraphResult(
    "overview",
    "",
    relations,
    entities,
    stats,
    nodeLimit,
    Math.round(nodeLimit * 1.15),
    relationScores.size,
  );
}

export async function queryKnowledgeGraph(
  rawQuery: string,
  rawLimit = GRAPH_DEFAULT_NODE_LIMIT,
): Promise<KnowledgeGraphQueryResult> {
  assertFileExists(KG_RELATIONS_FILE, "runtime/relations.compact.jsonl.gz");
  const query = normalizeKnowledgeGraphQuery(rawQuery);
  if (!query) {
    return queryKnowledgeGraphOverview(rawLimit);
  }

  const nodeLimit = Math.max(
    20,
    Math.min(
      Number(rawLimit) || GRAPH_DEFAULT_NODE_LIMIT,
      GRAPH_MAX_QUERY_NODE_LIMIT,
    ),
  );
  const edgeScanLimit = Math.max(
    nodeLimit,
    Math.min(nodeLimit * 3, GRAPH_EDGE_SCAN_LIMIT),
  );
  const [entities, stats, chunks] = await Promise.all([
    getKgEntities(),
    getKgStats(),
    searchRag(query).catch(() => []),
  ]);
  const recordSet = new Set(chunks.map((chunk) => chunk.recordId));
  const expandedTerms = await getExpandedKgTerms(query);

  const matchedRelations: KgRelation[] = [];
  const seen = new Set<string>();
  await readJsonl(KG_RELATIONS_FILE, (relation) => {
    if (!isVisualRelation(relation)) return;
    const scored = scoreRelation(relation, expandedTerms, recordSet);
    if (!scored) return;
    const key = relationKey(scored);
    if (seen.has(key)) return;
    seen.add(key);
    matchedRelations.push(scored);
  });

  const rankedRelations = matchedRelations
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(GRAPH_EDGE_SCAN_LIMIT, edgeScanLimit));
  return buildGraphResult(
    "query",
    query,
    rankedRelations,
    entities,
    stats,
    nodeLimit,
    Math.round(nodeLimit * 1.15),
    matchedRelations.length,
  );
}

export async function buildExternalRagKgContext(messages: ChatMessageLike[]) {
  const query = lastUserMessage(messages);
  if (!query) return null;

  const chunks = await searchRag(query);
  const relations = await searchKgRelations(
    query,
    chunks.map((chunk) => chunk.recordId),
  );

  if (!chunks.length && !relations.length) {
    return null;
  }

  const contextParts: string[] = [];
  const sources: RagKgSource[] = [];
  const documentSourceIds = new Map<string, string>();
  const addDocumentSource = (title: string, sourceUrl?: string) => {
    const normalizedTitle = normalizeTerm(title);
    if (!normalizedTitle) return "";
    const existingId = documentSourceIds.get(normalizedTitle);
    if (existingId) return existingId;
    if (documentSourceIds.size >= MAX_VISIBLE_RAG_SOURCES) return "";

    const sourceId = `S${documentSourceIds.size + 1}`;
    documentSourceIds.set(normalizedTitle, sourceId);
    sources.push({
      kind: "document",
      id: sourceId,
      title,
      sourceUrl: sourceUrl || undefined,
    });
    return sourceId;
  };
  let usedChars = 0;
  chunks.forEach((chunk) => {
    const sourceId = addDocumentSource(chunk.displayTitle, chunk.sourceUrl);

    const block = [
      sourceId ? `来源 ${sourceId}` : "内部检索资料",
      chunk.displayTitle ? `题名：${chunk.displayTitle}` : "",
      `内容：${chunk.text}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (usedChars + block.length <= MAX_CONTEXT_CHARS) {
      contextParts.push(block);
      usedChars += block.length;
    }
  });

  if (relations.length) {
    const visibleRelations: KgRelation[] = [];
    const visibleRelationKeys = new Set<string>();
    for (const relation of relations) {
      const key = relationKey(relation);
      if (visibleRelationKeys.has(key)) continue;
      visibleRelationKeys.add(key);
      visibleRelations.push(relation);
    }

    const relationText = visibleRelations
      .map((item, index) => {
        const evidenceSourceId = addDocumentSource(
          item.evidenceTitle || "",
          item.evidenceUrl,
        );
        const evidenceText = evidenceSourceId
          ? `（依据 ${evidenceSourceId}）`
          : "";
        return `知识关系 K${index + 1}${evidenceText}：${item.source}(${
          item.sourceType
        }) -[${item.relation}]-> ${item.target}(${item.targetType})`;
      })
      .join("\n");
    contextParts.push(`知识图谱依据\n${relationText}`);
    visibleRelations.slice(0, MAX_VISIBLE_KG_SOURCES).forEach((item, index) => {
      sources.push({
        kind: "graph",
        id: `K${index + 1}`,
        source: item.source,
        sourceType: item.sourceType,
        relation: item.relation,
        target: item.target,
        targetType: item.targetType,
      });
    });
  }

  const message = [
    "当前请求启用外部 RAG/KG 增强。",
    "以下检索内容来自本项目内部数据，仅作为回答依据。需要标注依据时，只能使用 [S1]、[S2] 这类已列出的来源编号；不要输出“片段1”“资料片段1”“文献1”“图谱关系1”等不可映射说法。",
    "正文不要输出 chunk_id、record_id、哈希文件名、内部路径或来源清单；界面会单独显示可核对来源。",
    "如果检索内容不足，应说明缺少的工程参数，并给出可验证的设计、制造、仿真或试验分析路径。",
    "",
    `用户问题：${query}`,
    "",
    contextParts.join("\n\n"),
  ].join("\n");

  return { message, sources };
}
