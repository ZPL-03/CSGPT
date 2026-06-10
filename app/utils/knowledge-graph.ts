import { Path } from "../constant";

const MEANINGLESS_GRAPH_QUERIES = new Set([
  "新的聊天",
  "新对话",
  "未命名对话",
  "默认标题",
  "你好",
  "您好",
  "谢谢",
  "好的",
  "好",
  "可以",
  "收到",
  "new chat",
  "untitled",
  "hello",
  "hi",
  "thanks",
  "ok",
]);

const MAX_GRAPH_QUERY_LENGTH = 360;
const MAX_CONVERSATION_QUERY_TERMS = 10;

const KNOWLEDGE_GRAPH_QUERY_TERMS = [
  "复合材料",
  "耐压壳",
  "耐压结构",
  "压力壳",
  "压力容器",
  "深海",
  "外压",
  "静水压力",
  "圆柱壳",
  "圆柱",
  "球壳",
  "层合壳",
  "层合板",
  "屈曲",
  "极限强度",
  "强度",
  "刚度",
  "稳定性",
  "安全系数",
  "铺层",
  "铺层角",
  "厚度",
  "质量",
  "缠绕",
  "缠绕角",
  "材料选择",
  "设计方案",
  "设计变量",
  "优化",
  "工艺",
  "制造",
  "约束",
  "有限元",
  "仿真",
  "试验",
  "失效准则",
  "失效",
  "Tsai-Wu",
  "Hashin",
  "碳纤维",
  "玻璃纤维",
  "树脂",
  "T700",
  "T800",
  "M40J",
  "CFRP",
  "GFRP",
  "composite material",
  "pressure hull",
  "pressure vessel",
  "external pressure",
  "hydrostatic pressure",
  "buckling",
  "laminate",
  "laminated plate",
  "filament winding",
  "winding angle",
  "failure criterion",
  "material selection",
  "finite element",
];

const GENERIC_GRAPH_QUERY_WORDS = new Set([
  "请",
  "帮我",
  "需要",
  "可以",
  "哪些",
  "什么",
  "怎么",
  "如何",
  "给我",
  "一下",
  "the",
  "and",
  "for",
  "with",
  "what",
  "how",
]);

export function normalizeKnowledgeGraphQuery(query: string) {
  const normalized = String(query || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (MEANINGLESS_GRAPH_QUERIES.has(normalized.toLowerCase())) return "";
  return normalized.slice(0, MAX_GRAPH_QUERY_LENGTH);
}

type QueryTermScore = {
  term: string;
  score: number;
  order: number;
};

function addQueryTerm(
  scores: Map<string, QueryTermScore>,
  term: string,
  score: number,
  order: number,
) {
  const normalized = term.trim();
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (GENERIC_GRAPH_QUERY_WORDS.has(key)) return;
  for (const existingKey of scores.keys()) {
    if (existingKey !== key && existingKey.includes(key)) return;
  }
  const previous = scores.get(key);
  if (previous) {
    previous.score += score;
    previous.order = Math.min(previous.order, order);
    return;
  }
  scores.set(key, { term: normalized, score, order });
}

export function buildKnowledgeGraphConversationQuery(parts: string[]) {
  const normalizedParts = parts
    .map((part) => normalizeKnowledgeGraphQuery(part))
    .filter(Boolean);
  if (!normalizedParts.length) return "";

  const scores = new Map<string, QueryTermScore>();
  let order = 0;

  normalizedParts.forEach((part, index) => {
    const partLower = part.toLowerCase();
    const recencyWeight = 1 + index / Math.max(1, normalizedParts.length);
    for (const term of KNOWLEDGE_GRAPH_QUERY_TERMS) {
      if (partLower.includes(term.toLowerCase())) {
        addQueryTerm(scores, term, 3 * recencyWeight, order);
        order += 1;
      }
    }

    const englishTokens = part.match(/[A-Za-z][A-Za-z0-9_+./-]{2,}/g) || [];
    for (const token of englishTokens) {
      addQueryTerm(scores, token, recencyWeight, order);
      order += 1;
    }
  });

  const terms = Array.from(scores.values())
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((item) => item.term);

  if (terms.length) {
    return normalizeKnowledgeGraphQuery(
      terms.slice(0, MAX_CONVERSATION_QUERY_TERMS).join(" "),
    );
  }

  return normalizeKnowledgeGraphQuery(normalizedParts.slice(-3).join(" "));
}

export function hasKnowledgeGraphQuery(query: string) {
  return normalizeKnowledgeGraphQuery(query).length > 0;
}

export function buildKnowledgeGraphPath(query: string) {
  const trimmed = normalizeKnowledgeGraphQuery(query);
  return trimmed
    ? `${Path.KnowledgeGraph}?q=${encodeURIComponent(trimmed)}`
    : Path.KnowledgeGraph;
}
