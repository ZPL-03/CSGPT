import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { buildKnowledgeGraphPath } from "../utils/knowledge-graph";
import CloseIcon from "../icons/close.svg";
import SearchIcon from "../icons/search.svg";
import GraphIcon from "../icons/graph.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import EyeIcon from "../icons/eye.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import ReloadIcon from "../icons/reload.svg";
import { IconButton } from "./button";
import { ErrorBoundary } from "./error";
import Locale from "../locales";
import { useUserStore } from "../store/user";
import styles from "./knowledge-graph.module.scss";

type CytoscapeCore = import("cytoscape").Core;
type CytoscapeElementDefinition = import("cytoscape").ElementDefinition;

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
  mode: "overview" | "query";
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

function colorForType(type: string) {
  return TYPE_COLORS[type] || "#64748b";
}

function formatCount(value: number) {
  return value.toLocaleString("zh-CN");
}

function nodeSize(node: GraphNode) {
  const weighted = Math.log1p(node.count || 0) + node.degree * 2;
  return Math.max(26, Math.min(58, 24 + weighted * 2.1));
}

function graphElements(
  data: GraphData,
  showLabels: boolean,
): CytoscapeElementDefinition[] {
  const nodes = data.nodes.map((node) => ({
    data: {
      id: node.id,
      label: node.label,
      displayLabel: showLabels ? node.label : "",
      type: node.type,
      count: node.count,
      degree: node.degree,
      color: colorForType(node.type),
      size: nodeSize(node),
    },
  }));
  const edges = data.edges.map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: showLabels ? edge.relation : "",
      relation: edge.relation,
      score: Math.max(1, edge.score || 1),
    },
  }));
  return [...nodes, ...edges];
}

export function KnowledgeGraphPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const queryFromUrl = useMemo(
    () => new URLSearchParams(location.search).get("q") || "",
    [location.search],
  );
  const [query, setQuery] = useState(queryFromUrl);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [showLabels, setShowLabels] = useState(true);
  const token = useUserStore((state) => state.token);

  const loadGraph = useCallback(
    async (nextQuery: string) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (nextQuery.trim()) params.set("q", nextQuery.trim());
        params.set("limit", "96");
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

  useEffect(() => {
    if (!data || !graphRef.current) return;
    let disposed = false;

    const renderGraph = async () => {
      const cytoscapeModule = await import("cytoscape");
      if (disposed || !graphRef.current) return;

      cyRef.current?.destroy();
      const cytoscape = cytoscapeModule.default;
      const cy = cytoscape({
        container: graphRef.current,
        elements: graphElements(data, showLabels),
        wheelSensitivity: 0.16,
        minZoom: 0.18,
        maxZoom: 2.6,
        style: [
          {
            selector: "node",
            style: {
              "background-color": "data(color)",
              width: "data(size)",
              height: "data(size)",
              label: "data(displayLabel)",
              color: "#1f2937",
              "font-size": 11,
              "font-weight": 600,
              "text-wrap": "wrap",
              "text-max-width": "96px",
              "text-valign": "bottom",
              "text-halign": "center",
              "text-margin-y": 8,
              "text-background-color": "#ffffff",
              "text-background-opacity": 0.82,
              "text-background-padding": "2px",
              "border-width": 2,
              "border-color": "#ffffff",
              "overlay-opacity": 0,
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": 5,
              "border-color": "#10a37f",
            },
          },
          {
            selector: "edge",
            style: {
              width: "mapData(score, 1, 12, 1, 4)",
              "curve-style": "bezier",
              "line-color": "rgba(82, 95, 127, 0.34)",
              "target-arrow-shape": "triangle",
              "target-arrow-color": "rgba(82, 95, 127, 0.44)",
              label: "data(label)",
              color: "#64748b",
              "font-size": 8,
              "text-rotation": "autorotate",
              "text-margin-y": -9,
              "text-background-color": "#ffffff",
              "text-background-opacity": 0.76,
              "text-background-padding": "2px",
              "overlay-opacity": 0,
            },
          },
        ],
        layout: {
          name: "cose",
          animate: false,
          fit: true,
          padding: 42,
          randomize: true,
          componentSpacing: 92,
          nodeRepulsion: () => 9800,
          nodeOverlap: 12,
          idealEdgeLength: () => 126,
          edgeElasticity: () => 0.12,
          nestingFactor: 1.15,
          gravity: 0.08,
          numIter: 1300,
        },
      });
      cyRef.current = cy;
      cy.on("tap", "node", (event) => {
        setSelectedNodeId(event.target.id());
      });
      cy.on("tap", (event) => {
        if (event.target === cy) setSelectedNodeId("");
      });
      requestAnimationFrame(() => cy.fit(undefined, 42));
    };

    void renderGraph();
    return () => {
      disposed = true;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [data, showLabels]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    if (selectedNodeId) {
      const node = cy.getElementById(selectedNodeId);
      if (node.length) {
        node.select();
        cy.animate(
          {
            center: { eles: node },
            zoom: Math.max(cy.zoom(), 0.9),
          },
          { duration: 260 },
        );
      }
    }
  }, [selectedNodeId]);

  const nodesById = useMemo(
    () => new Map((data?.nodes || []).map((node) => [node.id, node])),
    [data?.nodes],
  );
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : null;
  const visibleEdges = data?.edges || [];
  const selectedEdges = selectedNode
    ? visibleEdges
        .filter(
          (edge) =>
            edge.source === selectedNode.id || edge.target === selectedNode.id,
        )
        .sort((a, b) => b.score - a.score)
    : visibleEdges.slice(0, 18);
  const typeStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of data?.nodes || []) {
      counts.set(node.type, (counts.get(node.type) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data?.nodes]);

  const submit = () => {
    const nextPath = buildKnowledgeGraphPath(query);
    const currentPath = `${location.pathname}${location.search}`;
    if (nextPath === currentPath) {
      void loadGraph(query);
    } else {
      navigate(nextPath, { replace: true });
    }
  };

  const fitGraph = () => cyRef.current?.fit(undefined, 42);
  const zoomGraph = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
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
            <>
              <div className={styles["graph-summary"]}>
                <div>
                  <strong>
                    {data.mode === "overview"
                      ? Locale.KnowledgeGraph.OverviewMode
                      : Locale.KnowledgeGraph.QueryMode(data.query)}
                  </strong>
                  <span>
                    {data.mode === "overview"
                      ? Locale.KnowledgeGraph.OverviewDescription
                      : Locale.KnowledgeGraph.QueryDescription}
                  </span>
                </div>
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
              </div>
            </>
          )}

          <div className={styles["graph-content"]}>
            <div className={styles["graph-canvas"]}>
              <div className={styles["graph-controls"]}>
                <IconButton
                  icon={<ReloadIcon />}
                  text={Locale.KnowledgeGraph.Fit}
                  bordered
                  onClick={fitGraph}
                />
                <IconButton
                  icon={<MaxIcon />}
                  text={Locale.KnowledgeGraph.ZoomIn}
                  bordered
                  onClick={() => zoomGraph(1.18)}
                />
                <IconButton
                  icon={<MinIcon />}
                  text={Locale.KnowledgeGraph.ZoomOut}
                  bordered
                  onClick={() => zoomGraph(0.84)}
                />
                <IconButton
                  icon={showLabels ? <EyeIcon /> : <EyeOffIcon />}
                  text={
                    showLabels
                      ? Locale.KnowledgeGraph.HideLabels
                      : Locale.KnowledgeGraph.ShowLabels
                  }
                  bordered
                  onClick={() => setShowLabels((value) => !value)}
                />
              </div>
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
              <div ref={graphRef} className={styles["graph-viewport"]} />
            </div>

            <aside className={styles["graph-panel"]}>
              <section>
                <h3>
                  {selectedNode?.label || Locale.KnowledgeGraph.Relations}
                </h3>
                {selectedNode && (
                  <div className={styles["node-meta"]}>
                    <span>{selectedNode.type}</span>
                    <span>
                      {Locale.KnowledgeGraph.Degree(selectedNode.degree)}
                    </span>
                    <span>
                      {Locale.KnowledgeGraph.Count(selectedNode.count)}
                    </span>
                  </div>
                )}
              </section>

              {typeStats.length > 0 && (
                <section>
                  <h4>{Locale.KnowledgeGraph.Legend}</h4>
                  <div className={styles["legend-list"]}>
                    {typeStats.map(([type, count]) => (
                      <span key={type}>
                        <i style={{ background: colorForType(type) }} />
                        {type}
                        <b>{count}</b>
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h4>{Locale.KnowledgeGraph.SelectedRelations}</h4>
                <div className={styles["relation-list"]}>
                  {selectedEdges.length === 0 && (
                    <p className={styles["relation-empty"]}>
                      {Locale.KnowledgeGraph.NoRelations}
                    </p>
                  )}
                  {selectedEdges.slice(0, 36).map((edge) => {
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
              </section>
            </aside>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
