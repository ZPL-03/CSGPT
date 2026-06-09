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

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

function nodeSize(node: GraphNode) {
  const weighted = Math.log1p(node.count || 0) + node.degree * 1.2;
  return Math.max(12, Math.min(30, 11 + weighted * 1.1));
}

function nodeWeight(node: GraphNode) {
  return Math.log1p(node.count || 0) + node.degree * 2;
}

function componentRadius(size: number) {
  if (size <= 2) return 34;
  if (size <= 6) return 62;
  if (size <= 14) return 98;
  return 138 + Math.sqrt(size) * 18;
}

function positionComponent(
  nodes: GraphNode[],
  center: { x: number; y: number },
) {
  const positions = new Map<string, { x: number; y: number }>();
  const sorted = nodes.slice().sort((a, b) => nodeWeight(b) - nodeWeight(a));
  if (sorted.length === 1) {
    positions.set(sorted[0].id, center);
    return positions;
  }

  positions.set(sorted[0].id, center);
  const ringSizes = [8, 14, 22, 34];
  let offset = 1;
  for (
    let ring = 0;
    ring < ringSizes.length && offset < sorted.length;
    ring += 1
  ) {
    const ringCount = Math.min(ringSizes[ring], sorted.length - offset);
    const radius = 64 + ring * 64 + Math.max(0, sorted.length - 16) * 1.4;
    for (let item = 0; item < ringCount; item += 1) {
      const node = sorted[offset + item];
      const angle =
        -Math.PI / 2 + (Math.PI * 2 * item) / ringCount + ring * 0.2;
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }
    offset += ringCount;
  }

  return positions;
}

function layoutGraph(data: GraphData) {
  const nodeMap = new Map(data.nodes.map((node) => [node.id, node]));
  const adjacency = new Map(
    data.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of data.edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const seen = new Set<string>();
  const components: GraphNode[][] = [];
  for (const node of data.nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    seen.add(node.id);
    const component: GraphNode[] = [];
    while (stack.length) {
      const id = stack.pop()!;
      const current = nodeMap.get(id);
      if (current) component.push(current);
      for (const next of adjacency.get(id) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    components.push(component);
  }

  components.sort((left, right) => right.length - left.length);
  const positions = new Map<string, { x: number; y: number }>();
  const main = components[0] || [];
  for (const [id, position] of positionComponent(main, { x: 0, y: 0 })) {
    positions.set(id, position);
  }

  const mainRadius = componentRadius(main.length);
  const smallComponents = components.slice(1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(smallComponents.length)));
  const cellWidth = 125;
  const cellHeight = 105;
  const startX = mainRadius + 92;
  const startY = -Math.max(0, columns - 1) * cellHeight * 0.55;
  smallComponents.forEach((component, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const center = {
      x: startX + column * cellWidth,
      y: startY + row * cellHeight,
    };
    for (const [id, position] of positionComponent(component, center)) {
      positions.set(id, position);
    }
  });

  return positions;
}

function graphElements(
  data: GraphData,
  showAllLabels: boolean,
): CytoscapeElementDefinition[] {
  const coreLabelCount = data.mode === "overview" ? 10 : 8;
  const positions = layoutGraph(data);
  const nodes = data.nodes.map((node, index) => {
    const isCoreNode = index < coreLabelCount || node.degree >= 10;
    return {
      data: {
        id: node.id,
        label: node.label,
        displayLabel: showAllLabels || isCoreNode ? node.label : "",
        type: node.type,
        count: node.count,
        degree: node.degree,
        color: colorForType(node.type),
        size: nodeSize(node),
        weight: nodeWeight(node),
      },
      position: positions.get(node.id) || { x: 0, y: 0 },
    };
  });
  const edges = data.edges.map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: showAllLabels ? edge.relation : "",
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
  const queryInputRef = useRef<HTMLInputElement>(null);
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
  const [showAllLabels, setShowAllLabels] = useState(false);
  const token = useUserStore((state) => state.token);

  const loadGraph = useCallback(
    async (nextQuery: string) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (nextQuery.trim()) params.set("q", nextQuery.trim());
        params.set("limit", "56");
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
        setSelectedNodeId("");
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
      const themeText = cssVar("--black", "#1f2937");
      const themeSurface = cssVar("--white", "#ffffff");
      const cy = cytoscape({
        container: graphRef.current,
        elements: graphElements(data, showAllLabels),
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
              color: themeText,
              "font-size": 11,
              "font-weight": 600,
              "text-wrap": "wrap",
              "text-max-width": "94px",
              "text-valign": "bottom",
              "text-halign": "center",
              "text-margin-y": 5,
              "text-background-color": themeSurface,
              "text-background-opacity": 0.86,
              "text-background-padding": "2px",
              "border-width": 1.5,
              "border-color": themeSurface,
              "overlay-opacity": 0,
            },
          },
          {
            selector: "node:selected",
            style: {
              "border-width": 3,
              "border-color": "#10a37f",
              label: "data(label)",
            },
          },
          {
            selector: "edge",
            style: {
              width: "mapData(score, 1, 12, 0.7, 2.4)",
              "curve-style": "unbundled-bezier",
              "control-point-distances": 22,
              "control-point-weights": 0.5,
              "line-color": "rgba(96, 116, 145, 0.28)",
              "target-arrow-shape": "triangle",
              "target-arrow-color": "rgba(96, 116, 145, 0.36)",
              label: "data(label)",
              color: themeText,
              "font-size": 8,
              "text-rotation": "autorotate",
              "text-margin-y": -9,
              "text-background-color": themeSurface,
              "text-background-opacity": 0.78,
              "text-background-padding": "2px",
              "overlay-opacity": 0,
            },
          },
        ],
        layout: { name: "preset", fit: false },
      });
      cyRef.current = cy;
      cy.on("tap", "node", (event) => {
        setSelectedNodeId(event.target.id());
      });
      cy.on("tap", (event) => {
        if (event.target === cy) setSelectedNodeId("");
      });
      cy.layout({
        name: "cose",
        animate: false,
        fit: false,
        randomize: false,
        idealEdgeLength: 118,
        nodeOverlap: 14,
        nodeRepulsion: 280000,
        edgeElasticity: 90,
        gravity: 38,
        numIter: 900,
        initialTemp: 140,
        coolingFactor: 0.96,
      } as any).run();
      requestAnimationFrame(() => {
        if (disposed) return;
        cy.resize();
        cy.fit(cy.elements(), 36);
      });
      window.setTimeout(() => {
        if (disposed) return;
        cy.resize();
        cy.fit(cy.elements(), 36);
      }, 320);
    };

    void renderGraph();
    return () => {
      disposed = true;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [data, showAllLabels]);

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
    const currentQuery = queryInputRef.current?.value ?? query;
    setQuery(currentQuery);
    const nextPath = buildKnowledgeGraphPath(currentQuery);
    const currentPath = `${location.pathname}${location.search}`;
    if (nextPath === currentPath) {
      void loadGraph(currentQuery);
    } else {
      navigate(nextPath);
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
                onClick={() => navigate(Path.Chat)}
              />
            </div>
          </div>
        </div>

        <div className={styles["graph-body"]}>
          <div className={styles["graph-toolbar"]}>
            <div className={styles["graph-search"]}>
              <GraphIcon />
              <input
                ref={queryInputRef}
                value={query}
                placeholder={Locale.KnowledgeGraph.SearchPlaceholder}
                onChange={(event) => setQuery(event.currentTarget.value)}
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
                  icon={showAllLabels ? <EyeIcon /> : <EyeOffIcon />}
                  text={
                    showAllLabels
                      ? Locale.KnowledgeGraph.HideLabels
                      : Locale.KnowledgeGraph.ShowLabels
                  }
                  bordered
                  onClick={() => setShowAllLabels((value) => !value)}
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
