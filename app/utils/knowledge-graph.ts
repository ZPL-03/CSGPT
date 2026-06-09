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
const MAX_CONVERSATION_QUERY_TERMS = 12;

const KNOWLEDGE_GRAPH_QUERY_TERMS = [
  "复合材料",
  "耐压壳",
  "压力壳",
  "压力容器",
  "深海",
  "外压",
  "静水压力",
  "圆柱壳",
  "层合壳",
  "屈曲",
  "极限强度",
  "安全系数",
  "铺层",
  "缠绕",
  "缠绕角",
  "设计方案",
  "设计变量",
  "工艺",
  "制造",
  "约束",
  "有限元",
  "仿真",
  "试验",
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
  "filament winding",
  "winding angle",
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

function addQueryTerm(terms: string[], seen: Set<string>, term: string) {
  const normalized = term.trim();
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (seen.has(key) || GENERIC_GRAPH_QUERY_WORDS.has(key)) return;
  seen.add(key);
  terms.push(normalized);
}

export function buildKnowledgeGraphConversationQuery(parts: string[]) {
  const normalizedParts = parts
    .map((part) => normalizeKnowledgeGraphQuery(part))
    .filter(Boolean);
  if (!normalizedParts.length) return "";

  const joined = normalizedParts.join(" ");
  const joinedLower = joined.toLowerCase();
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const term of KNOWLEDGE_GRAPH_QUERY_TERMS) {
    if (joinedLower.includes(term.toLowerCase())) {
      addQueryTerm(terms, seen, term);
    }
  }

  const englishTokens = joined.match(/[A-Za-z][A-Za-z0-9_+./-]{2,}/g) || [];
  for (const token of englishTokens) {
    addQueryTerm(terms, seen, token);
    if (terms.length >= MAX_CONVERSATION_QUERY_TERMS) break;
  }

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
