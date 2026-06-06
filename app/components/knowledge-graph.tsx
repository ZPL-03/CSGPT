import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { buildKnowledgeGraphPath } from "../utils/knowledge-graph";
import CloseIcon from "../icons/close.svg";
import SearchIcon from "../icons/search.svg";
import GraphIcon from "../icons/graph.svg";
import { IconButton } from "./button";
import { ErrorBoundary } from "./error";
import Locale from "../locales";
import { useUserStore } from "../store/user";
import styles from "./knowledge-graph.module.scss";

type GraphNode = {
  id: string;
  label: string;
  type: string;
  count: number;
  degree: number;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  recordId: string;
  score: number;
};

type GraphData = {
  query: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalEntities: number;
    totalRelations: number;
    matchedRelations: number;
    returnedNodes: number;
    returnedEdges: number;
  };
};

type LayoutNode = GraphNode & {
  x: number;
  y: number;
};

const TYPE_COLORS: Record<string, string> = {
  Material: "#2f80ed",
  Structure: "#00a07a",
  FailureMode: "#d35454",
  ManufacturingProcess: "#a05a2c",
  Standard: "#7b61ff",
  Property: "#d08a00",
  Application: "#0087a8",
  TaskCategory: "#6a7a89",
  Literature: "#8c6f47",
  LoadCase: "#c05a9d",
  DesignFormula: "#4f7a30",
  StiffnessCoeff: "#5c6ac4",
  DesignVariable: "#b05f6d",
  VerificationMethod: "#51606d",
};

const WIDTH = 1120;
const HEIGHT = 660;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

function colorForType(type: string) {
  return TYPE_COLORS[type] || "#64748b";
}

function layoutNodes(nodes: GraphNode[]): LayoutNode[] {
  if (nodes.length === 0) return [];
  const sorted = [...nodes].sort(
    (a, b) => b.degree - a.degree || b.count - a.count,
  );
  return sorted.map((node, index) => {
    if (index === 0) {
      return { ...node, x: CENTER_X, y: CENTER_Y };
    }
    const ringIndex = index <= 24 ? 0 : index <= 72 ? 1 : 2;
    const ringStart = ringIndex === 0 ? 1 : ringIndex === 1 ? 25 : 73;
    const ringSize = ringIndex === 0 ? 24 : ringIndex === 1 ? 48 : 96;
    const position = index - ringStart;
    const angle = (Math.PI * 2 * position) / ringSize - Math.PI / 2;
    const radius = ringIndex === 0 ? 170 : ringIndex === 1 ? 265 : 320;
    return {
      ...node,
      x: CENTER_X + Math.cos(angle) * radius,
      y: CENTER_Y + Math.sin(angle) * radius,
    };
  });
}

function truncateLabel(label: string, limit = 24) {
  if (label.length <= limit) return label;
  return `${label.slice(0, limit - 1)}…`;
}

function formatCount(value: number) {
  return value.toLocaleString("zh-CN");
}

export function KnowledgeGraphPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryFromUrl = useMemo(
    () => new URLSearchParams(location.search).get("q") || "",
    [location.search],
  );
  const [query, setQuery] = useState(queryFromUrl);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const token = useUserStore((state) => state.token);

  const loadGraph = useCallback(
    async (nextQuery: string) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (nextQuery.trim()) params.set("q", nextQuery.trim());
        params.set("limit", "120");
        const response = await fetch(`/api/knowledge-graph?${params}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || Locale.KnowledgeGraph.Error);
        }
        const result = (await response.json()) as GraphData;
        setData(result);
        setSelectedNodeId(result.nodes[0]?.id || "");
      } catch (err: any) {
        setError(err?.message || Locale.KnowledgeGraph.Error);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    setQuery(queryFromUrl);
    void loadGraph(queryFromUrl);
  }, [loadGraph, queryFromUrl]);

  const layout = useMemo(() => layoutNodes(data?.nodes || []), [data?.nodes]);
  const nodesById = useMemo(
    () => new Map(layout.map((node) => [node.id, node])),
    [layout],
  );
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : null;
  const visibleEdges = data?.edges || [];
  const selectedEdges = selectedNode
    ? visibleEdges.filter(
        (edge) =>
          edge.source === selectedNode.id || edge.target === selectedNode.id,
      )
    : visibleEdges.slice(0, 12);

  const submit = () => {
    const nextPath = buildKnowledgeGraphPath(query);
    const currentPath = `${location.pathname}${location.search}`;
    if (nextPath === currentPath) {
      void loadGraph(query);
    } else {
      navigate(nextPath, { replace: true });
    }
  };

  return (
    <ErrorBoundary>
      <div className={styles["graph-page"]}>
        <div className="window-header">
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.KnowledgeGraph.Title}
            </div>
            <div className="window-header-submai-title">
              {data
                ? Locale.KnowledgeGraph.SubTitle(
                    data.stats.returnedNodes,
                    data.stats.returnedEdges,
                  )
                : Locale.KnowledgeGraph.EmptySubTitle}
            </div>
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<CloseIcon />}
                bordered
                onClick={() => navigate(Path.Chat, { replace: true })}
              />
            </div>
          </div>
        </div>

        <div className={styles["graph-body"]}>
          <div className={styles["graph-toolbar"]}>
            <div className={styles["graph-search"]}>
              <GraphIcon />
              <input
                value={query}
                placeholder={Locale.KnowledgeGraph.SearchPlaceholder}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </div>
            <IconButton
              icon={<SearchIcon />}
              text={Locale.KnowledgeGraph.Search}
              bordered
              onClick={submit}
            />
          </div>

          {data && (
            <div className={styles["graph-stats"]}>
              <span>
                {Locale.KnowledgeGraph.TotalEntities(
                  formatCount(data.stats.totalEntities),
                )}
              </span>
              <span>
                {Locale.KnowledgeGraph.TotalRelations(
                  formatCount(data.stats.totalRelations),
                )}
              </span>
              <span>
                {Locale.KnowledgeGraph.MatchedRelations(
                  formatCount(data.stats.matchedRelations),
                )}
              </span>
            </div>
          )}

          <div className={styles["graph-content"]}>
            <div className={styles["graph-canvas"]}>
              {loading && (
                <div className={styles["graph-state"]}>
                  {Locale.KnowledgeGraph.Loading}
                </div>
              )}
              {!loading && error && (
                <div className={styles["graph-state"]}>{error}</div>
              )}
              {!loading && !error && data && data.nodes.length === 0 && (
                <div className={styles["graph-state"]}>
                  {Locale.KnowledgeGraph.NoResult}
                </div>
              )}
              {!loading && !error && layout.length > 0 && (
                <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img">
                  <defs>
                    <marker
                      id="graph-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                  </defs>
                  <g className={styles["graph-edges"]}>
                    {visibleEdges.map((edge) => {
                      const source = nodesById.get(edge.source);
                      const target = nodesById.get(edge.target);
                      if (!source || !target) return null;
                      return (
                        <line
                          key={edge.id}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          className={styles["graph-edge"]}
                          markerEnd="url(#graph-arrow)"
                        />
                      );
                    })}
                  </g>
                  <g className={styles["graph-nodes"]}>
                    {layout.map((node) => {
                      const active = node.id === selectedNodeId;
                      const radius = Math.max(
                        15,
                        Math.min(34, 14 + node.degree * 2),
                      );
                      return (
                        <g
                          key={node.id}
                          className={styles["graph-node"]}
                          transform={`translate(${node.x} ${node.y})`}
                          onClick={() => setSelectedNodeId(node.id)}
                          aria-label={`${node.label} / ${node.type}`}
                        >
                          <circle
                            r={radius}
                            fill={colorForType(node.type)}
                            className={
                              active ? styles["graph-node-active"] : ""
                            }
                          />
                          <text y={radius + 17}>
                            {truncateLabel(node.label)}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}
            </div>

            <aside className={styles["graph-panel"]}>
              <h3>{selectedNode?.label || Locale.KnowledgeGraph.Relations}</h3>
              {selectedNode && (
                <div className={styles["node-meta"]}>
                  <span>{selectedNode.type}</span>
                  <span>
                    {Locale.KnowledgeGraph.Degree(selectedNode.degree)}
                  </span>
                  <span>{Locale.KnowledgeGraph.Count(selectedNode.count)}</span>
                </div>
              )}
              <div className={styles["relation-list"]}>
                {selectedEdges.length === 0 && (
                  <p className={styles["relation-empty"]}>
                    {Locale.KnowledgeGraph.NoRelations}
                  </p>
                )}
                {selectedEdges.slice(0, 30).map((edge) => {
                  const source = nodesById.get(edge.source);
                  const target = nodesById.get(edge.target);
                  return (
                    <button
                      key={edge.id}
                      className={styles["relation-item"]}
                      onClick={() =>
                        setSelectedNodeId(target?.id || edge.target)
                      }
                    >
                      <span>{source?.label || edge.source}</span>
                      <strong>{edge.relation}</strong>
                      <span>{target?.label || edge.target}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
