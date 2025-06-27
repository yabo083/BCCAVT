"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { CommentDataProcessor } from "@/utils/commentDataProcessor";
import { GraphNode, GraphLink } from "@/types/comment";

interface VisualizationComponentProps {
  processor: CommentDataProcessor;
  onReset: () => void;
}

interface NodeDetailModalProps {
  node: GraphNode | null;
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onCollapse: () => void;
}

const NodeDetailModal: React.FC<NodeDetailModalProps> = ({
  node,
  isOpen,
  isCollapsed,
  onClose,
  onCollapse,
}) => {
  if (!isOpen || !node) return null;

  return (
    <div
      className={`fixed top-20 right-4 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200/50 max-w-sm w-full z-50 
      ${
        isCollapsed ? "h-16" : "max-h-96"
      } overflow-hidden transition-all duration-300 transform`}
    >
      <div
        className="flex items-center justify-between px-4 py-1.2 border-b border-t border-gray-200/50 bg-gradient-to-r from-blue-50 to-purple-50"
        style={{ borderTopWidth: "1px", borderBottomWidth: "1px" }}
      >
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex-shrink-0"></div>
          <h3 className="font-semibold text-gray-900 truncate">评论详情</h3>
        </div>
        <div className="flex space-x-1">
          <button
            onClick={onCollapse}
            className="p-2 hover:bg-white/50 rounded-full text-gray-600 hover:text-gray-800 transition-all duration-200 transform hover:scale-110"
            title={isCollapsed ? "展开详情" : "收起详情"}
          >
            <span
              className={`inline-block transition-transform duration-500 ease-in-out ${
                isCollapsed ? "rotate-0" : "rotate-180"
              }`}
            >
              ▼
            </span>
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-red-50 rounded-lg text-gray-600 hover:text-red-600 transition-all duration-200 transform hover:scale-110"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-3 space-y-2 bg-gradient-to-b from-white to-gray-50/50 animate-in slide-in-from-top-2 duration-200">
          <div className="bg-gray-50 rounded-md p-2 border border-gray-200">
            <p className="text-sm text-gray-800 leading-relaxed line-clamp-3">
              <span className="text-sm text-gray-800 font-medium">
                {node.name}：
              </span>
              <span className="ml-1">{node.content}</span>
            </p>
          </div>
          <div style={{ fontSize: 13.5, color: "#666", paddingTop: 2 }}>
            点赞数：{node.likes}　度数：{node.degree}　时间：
            {(() => {
              if (!node.time || isNaN(Number(node.time))) return "无";
              let t = Number(node.time);
              if (t > 1e12) t = Math.floor(t / 1000);
              if (t > 0) return new Date(t * 1000).toLocaleString();
              return "无";
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export const VisualizationComponent: React.FC<VisualizationComponentProps> = ({
  processor,
  onReset,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [minDegree, setMinDegree] = useState(0);
  const [maxDegree, setMaxDegree] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");
  const [clusterMode, setClusterMode] = useState<
    "radial" | "linear" | "isolated" | null
  >(null);
  const [isControlPanelExpanded, setIsControlPanelExpanded] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModalCollapsed, setIsModalCollapsed] = useState(false);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(
    null
  );
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // 添加聚类相关状态
  const [clusterData, setClusterData] = useState<{
    radial: {
      centers: GraphNode[];
      children: Map<string, GraphNode[]>;
      links: GraphLink[];
    } | null;
    linear: { chains: { nodes: GraphNode[]; links: GraphLink[] }[] } | null;
    isolated: { nodes: GraphNode[]; links: GraphLink[] } | null;
  }>({
    radial: null,
    linear: null,
    isolated: null,
  });

  // 添加聚类排行榜状态
  const [isRankingOpen, setIsRankingOpen] = useState(false);
  const [rankingData, setRankingData] = useState<{
    radial: { node: GraphNode; childCount: number }[];
    linear: { nodes: GraphNode[]; length: number }[];
    isolated: GraphNode[];
  }>({
    radial: [],
    linear: [],
    isolated: [],
  });

  // 1. 新增专研模式相关 state
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusInfo, setFocusInfo] = useState<string>("");

  // 2. BFS 查找与某节点连通的所有节点（移到组件顶层）
  const findConnectedComponent = useCallback(
    (startId: string) => {
      const adj = new Map<string, string[]>();
      links.forEach((l) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        if (!adj.has(s)) adj.set(s, []);
        if (!adj.has(t)) adj.set(t, []);
        adj.get(s)!.push(t);
        adj.get(t)!.push(s);
      });
      const visited = new Set<string>();
      const queue = [startId];
      while (queue.length) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        (adj.get(cur) || []).forEach((nei) => {
          if (!visited.has(nei)) queue.push(nei);
        });
      }
      return visited;
    },
    [links]
  );

  // Initialize data
  useEffect(() => {
    const graphData = processor.getGraphData();
    const degreeStats = processor.getDegreeStats();

    setNodes(graphData.nodes);
    setLinks(graphData.links);
    setMinDegree(degreeStats.minDegree);
    setMaxDegree(degreeStats.maxDegree);
  }, [processor]);

  // D3 visualization setup
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous visualization
    svg.selectAll("*").remove();

    // Create main group
    const g = svg.append("g").attr("class", "main-group");

    // Add zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Add arrow markers
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 15)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .append("path")
      .attr("d", "M 0,-5 L 10,0 L 0,5")
      .attr("fill", "#999");

    // --- 专研模式节点集合 ---
    let focusSet = new Set<string>();
    if (isFocusMode && focusNodeId) {
      focusSet = findConnectedComponent(focusNodeId);
    }

    // --- Links ---
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => {
        if (isFocusMode && focusNodeId) {
          const s = typeof d.source === "object" ? d.source.id : d.source;
          const t = typeof d.target === "object" ? d.target.id : d.target;
          return focusSet.has(s) && focusSet.has(t) ? "#3498db" : "#ddd";
        }
        return "#999";
      })
      .attr("stroke-opacity", (d) => {
        if (isFocusMode && focusNodeId) {
          const s = typeof d.source === "object" ? d.source.id : d.source;
          const t = typeof d.target === "object" ? d.target.id : d.target;
          return focusSet.has(s) && focusSet.has(t) ? 0.9 : 0.1;
        }
        return 0.6;
      })
      .attr("stroke-width", (d) => {
        if (isFocusMode && focusNodeId) {
          const s = typeof d.source === "object" ? d.source.id : d.source;
          const t = typeof d.target === "object" ? d.target.id : d.target;
          return focusSet.has(s) && focusSet.has(t) ? 2 : 1;
        }
        return 1;
      })
      .attr("marker-end", "url(#arrowhead)")
      .attr("display", (d) => {
        if (isFocusMode && focusNodeId) {
          const s = typeof d.source === "object" ? d.source.id : d.source;
          const t = typeof d.target === "object" ? d.target.id : d.target;
          return focusSet.has(s) && focusSet.has(t) ? null : "none";
        }
        return null;
      });

    // --- Nodes ---
    const nodeGroup = g
      .append("g")
      .attr("class", "nodes")
      .selectAll(".node")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .attr("display", (d) => {
        if (isFocusMode && focusNodeId) {
          return focusSet.has(d.id) ? null : "none";
        }
        return null;
      });

    nodeGroup
      .append("circle")
      .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15))
      .attr("fill", (d) => {
        if (isFocusMode && focusNodeId) {
          return d.id === focusNodeId
            ? "#1e90ff"
            : focusSet.has(d.id)
            ? "#6ec1ff"
            : "#ddd";
        }
        return "#69b3a2";
      })
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    nodeGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => {
        const r = Math.min(Math.sqrt(d.likes) + 3, 15);
        return -(r + 6);
      })
      .attr("font-size", "12px")
      .attr("fill", (d) => {
        if (isFocusMode && focusNodeId) {
          return d.id === focusNodeId
            ? "#003366"
            : focusSet.has(d.id)
            ? "#003366"
            : "#ccc";
        }
        return "#333";
      })
      .style("pointer-events", "none")
      .style("paint-order", "stroke")
      .style("stroke", "#ffffff")
      .style("stroke-width", "3px")
      .style("stroke-linejoin", "round")
      .text((d) => d.name);

    // --- Tooltips & Click ---
    nodeGroup
      .on("mouseover", function (event, d) {
        if (isModalOpen) return;
        const tooltip = d3
          .select("body")
          .append("div")
          .attr("class", "tooltip")
          .style("position", "absolute")
          .style("background", "rgba(0, 0, 0, 0.8)")
          .style("color", "white")
          .style("padding", "8px")
          .style("border-radius", "4px")
          .style("font-size", "12px")
          .style("pointer-events", "none")
          .style("z-index", "1000").html(`
            <strong>${d.name}</strong><br/>
            点赞: ${d.likes} | 度数: ${d.degree}<br/>
            ${d.content?.substring(0, 100)}${
          d.content && d.content.length > 100 ? "..." : ""
        }
          `);
        tooltip
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY + 10 + "px");
      })
      .on("mouseout", function () {
        d3.selectAll(".tooltip").remove();
      })
      .on("click", function (event, d) {
        if (isFocusMode) {
          setFocusNodeId(d.id);
          setFocusInfo(
            `专研模式：已显示与"${d.name}"相关的${
              findConnectedComponent(d.id).size
            }个节点`
          );
          d3.selectAll(".tooltip").remove();
          return;
        }
        setSelectedNode(d);
        setIsModalOpen(true);
        d3.selectAll(".tooltip").remove();
      });

    // Create simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(100)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.05));

    simulationRef.current = simulation;

    // Add drag behavior
    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // Apply drag to nodes
    // @ts-expect-error - D3 drag behavior type compatibility
    nodeGroup.call(drag);

    // Update positions on tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as unknown as GraphNode).x!)
        .attr("y1", (d) => (d.source as unknown as GraphNode).y!)
        .attr("x2", (d) => (d.target as unknown as GraphNode).x!)
        .attr("y2", (d) => (d.target as unknown as GraphNode).y!);

      nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Set initial zoom
    const initialScale = 0.8;
    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(initialScale)
        .translate(-width / 2, -height / 2)
    );

    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [
    nodes,
    links,
    isModalOpen,
    isFocusMode,
    focusNodeId,
    findConnectedComponent,
  ]);

  // Handle search
  const handleSearch = useCallback(() => {
    if (!searchQuery.trim() || !svgRef.current) return;

    const foundNode = processor.searchByUsername(searchQuery);
    const svg = d3.select(svgRef.current);

    if (foundNode) {
      svg
        .selectAll(".node circle")
        .attr("fill", (d: unknown) => {
          const node = d as GraphNode;
          return node.id === foundNode.id ? "#ff5733" : "#69b3a2";
        })
        .attr("r", (d: unknown) => {
          const node = d as GraphNode;
          return node.id === foundNode.id
            ? Math.min(Math.sqrt(node.likes) + 6, 18)
            : Math.min(Math.sqrt(node.likes) + 3, 15);
        });
    } else {
      alert("未找到相关用户");
    }
  }, [searchQuery, processor]);

  // Handle degree filter
  const handleDegreeFilter = useCallback(() => {
    if (!svgRef.current) return;

    const allNodes = processor.getGraphData().nodes;
    const allLinks = processor.getGraphData().links;
    const svg = d3.select(svgRef.current);

    // Step 0: reset all nodes & links to the default style before applying the filter
    svg
      .selectAll<SVGCircleElement, GraphNode>(".node circle")
      .attr("fill", "#69b3a2")
      .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15))
      .attr("opacity", 1);

    svg
      .selectAll<SVGLineElement, GraphLink>(".links line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1);

    // --- Build helper sets ---
    const highlightedNodeIds = new Set<string>();
    const relatedNodeIds = new Set<string>();
    const relatedLinkKeys = new Set<string>();

    // 1) pick nodes in the degree range
    allNodes.forEach((node) => {
      if (node.degree >= minDegree && node.degree <= maxDegree) {
        highlightedNodeIds.add(node.id);
      }
    });

    // 2) find links that touch the highlighted nodes and collect related nodes/links
    allLinks.forEach((link) => {
      const sourceId =
        typeof link.source === "object"
          ? (link.source as GraphNode).id
          : String(link.source);
      const targetId =
        typeof link.target === "object"
          ? (link.target as GraphNode).id
          : String(link.target);

      const touchesHighlighted =
        highlightedNodeIds.has(sourceId) || highlightedNodeIds.has(targetId);

      if (touchesHighlighted) {
        relatedNodeIds.add(sourceId);
        relatedNodeIds.add(targetId);
        relatedLinkKeys.add(`${sourceId}-${targetId}`);
      }
    });

    // 3) style nodes
    svg
      .selectAll<SVGCircleElement, GraphNode>(".node circle")
      .attr("fill", (d) => {
        if (highlightedNodeIds.has(d.id)) return "#ff6b6b"; // primary highlight
        if (relatedNodeIds.has(d.id)) return "#4ecdc4"; // secondary/related
        return "#ddd"; // faded
      })
      .attr("r", (d) => {
        if (highlightedNodeIds.has(d.id)) return 20;
        return Math.min(Math.sqrt(d.likes) + 3, 15);
      })
      .attr("opacity", (d) => (highlightedNodeIds.has(d.id) ? 1 : 0.8));

    // 4) style links
    svg
      .selectAll<SVGLineElement, GraphLink>(".links line")
      .attr("stroke", (l) => {
        const sourceId =
          typeof l.source === "object"
            ? (l.source as GraphNode).id
            : String(l.source);
        const targetId =
          typeof l.target === "object"
            ? (l.target as GraphNode).id
            : String(l.target);
        return relatedLinkKeys.has(`${sourceId}-${targetId}`)
          ? "#4ecdc4"
          : "#ddd";
      })
      .attr("stroke-opacity", (l) => {
        const sourceId =
          typeof l.source === "object"
            ? (l.source as GraphNode).id
            : String(l.source);
        const targetId =
          typeof l.target === "object"
            ? (l.target as GraphNode).id
            : String(l.target);
        return relatedLinkKeys.has(`${sourceId}-${targetId}`) ? 1 : 0.2;
      })
      .attr("stroke-width", (l) => {
        const sourceId =
          typeof l.source === "object"
            ? (l.source as GraphNode).id
            : String(l.source);
        const targetId =
          typeof l.target === "object"
            ? (l.target as GraphNode).id
            : String(l.target);
        return relatedLinkKeys.has(`${sourceId}-${targetId}`) ? 2 : 1;
      });
  }, [minDegree, maxDegree, processor]);

  // Handle cluster modes
  const handleClusterMode = useCallback(
    (mode: "radial" | "linear" | "isolated") => {
      if (!svgRef.current) return;

      const svg = d3.select(svgRef.current);
      const newMode = clusterMode === mode ? null : mode;
      setClusterMode(newMode);

      console.log("聚类模式切换:", {
        当前模式: clusterMode,
        新模式: newMode,
        目标模式: mode,
      });

      // Reset styles
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("fill", "#69b3a2")
        .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15));

      svg
        .selectAll<SVGLineElement, GraphLink>(".links line")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6);

      if (newMode === "radial") {
        const { centers, children } = processor.findRadialClusters();
        console.log("=== 放射状聚类分析 ===");
        console.log("中心节点数量:", centers.length);
        console.log(
          "中心节点详情:",
          centers.map((c) => ({ id: c.id, name: c.name, degree: c.degree }))
        );
        console.log("子节点映射:", children.size);

        // 计算总的高亮节点数
        let totalHighlightNodes = centers.length;
        children.forEach((childNodes) => {
          totalHighlightNodes += childNodes.length;
        });
        console.log("总高亮节点数:", totalHighlightNodes);

        // Highlight center nodes
        svg
          .selectAll<SVGCircleElement, GraphNode>(".node circle")
          .filter((d: unknown) => {
            const node = d as GraphNode;
            return centers.some((center) => center.id === node.id);
          })
          .attr("fill", "#ff5733")
          .attr("r", (d: unknown) => {
            const node = d as GraphNode;
            return Math.min(Math.sqrt(node.likes) + 6, 20);
          });

        // Highlight child nodes (excluding center nodes)
        const centerIds = new Set(centers.map((c) => c.id));
        centers.forEach((center) => {
          const childNodes = children.get(center.id) || [];
          console.log(`中心节点 ${center.name} 的子节点数:`, childNodes.length);
          svg
            .selectAll<SVGCircleElement, GraphNode>(".node circle")
            .filter((d: unknown) => {
              const node = d as GraphNode;
              // 只高亮子节点，排除已经是中心节点的节点
              return (
                childNodes.some((child) => child.id === node.id) &&
                !centerIds.has(node.id)
              );
            })
            .attr("fill", "#ffa07a")
            .attr("r", (d: unknown) => {
              const node = d as GraphNode;
              return Math.min(Math.sqrt(node.likes) + 4, 16);
            });
        });
      } else if (newMode === "linear") {
        const { chains } = processor.findLinearClusters();
        console.log("=== 线性聚类分析 ===");
        console.log("链条数量:", chains.length);

        let totalChainNodes = 0;
        chains.forEach((chain, index) => {
          const color = d3.schemeCategory10[index % 10];
          console.log(`链条 ${index + 1}:`, {
            节点数: chain.nodes.length,
            连接数: chain.links.length,
            颜色: color,
            节点详情: chain.nodes.map((n) => ({
              id: n.id,
              name: n.name,
              degree: n.degree,
            })),
          });
          totalChainNodes += chain.nodes.length;

          svg
            .selectAll<SVGCircleElement, GraphNode>(".node circle")
            .filter((d: unknown) => {
              const node = d as GraphNode;
              return chain.nodes.some((chainNode) => chainNode.id === node.id);
            })
            .attr("fill", color)
            .attr("r", (d: unknown) => {
              const node = d as GraphNode;
              return Math.min(Math.sqrt(node.likes) + 4, 16);
            });
        });
        console.log("总链条节点数:", totalChainNodes);
      } else if (newMode === "isolated") {
        const { nodes: isolatedNodes } = processor.findIsolatedNodes();
        console.log("=== 孤立节点分析 ===");
        console.log("孤立节点数量:", isolatedNodes.length);
        console.log(
          "孤立节点详情:",
          isolatedNodes.map((n) => ({
            id: n.id,
            name: n.name,
            degree: n.degree,
            likes: n.likes,
          }))
        );

        svg
          .selectAll<SVGCircleElement, GraphNode>(".node circle")
          .filter((d: unknown) => {
            const node = d as GraphNode;
            return isolatedNodes.some(
              (isolatedNode) => isolatedNode.id === node.id
            );
          })
          .attr("fill", "#8a2be2")
          .attr("r", (d: unknown) => {
            const node = d as GraphNode;
            return Math.min(Math.sqrt(node.likes) + 4, 16);
          });
      }

      if (newMode === null) {
        console.log("=== 聚类模式已关闭 ===");
      }
    },
    [clusterMode, processor]
  );

  // Handle fullscreen
  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Handle reset
  const handleVisualizationReset = useCallback(() => {
    const graphData = processor.getGraphData();
    setNodes(graphData.nodes);
    setLinks(graphData.links);
    setClusterMode(null);
    setSearchQuery("");

    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("fill", "#69b3a2")
        .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15));

      svg
        .selectAll<SVGLineElement, GraphLink>(".links line")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6);
    }
  }, [processor]);

  // 更新聚类数据
  useEffect(() => {
    if (!processor) return;

    const radialClusters = processor.findRadialClusters();
    const linearClusters = processor.findLinearClusters();
    const isolatedNodes = processor.findIsolatedNodes();

    setClusterData({
      radial: radialClusters,
      linear: linearClusters,
      isolated: isolatedNodes,
    });

    // 更新排行榜数据
    setRankingData({
      radial: radialClusters.centers
        .map((center) => ({
          node: center,
          childCount: radialClusters.children.get(center.id)?.length || 0,
        }))
        .sort((a, b) => b.childCount - a.childCount),
      linear: linearClusters.chains
        .map((chain) => ({ nodes: chain.nodes, length: chain.nodes.length }))
        .sort((a, b) => b.length - a.length),
      isolated: isolatedNodes.nodes.sort((a, b) => b.likes - a.likes),
    });
  }, [processor]);

  // 聚类高亮函数
  const highlightCluster = useCallback(
    (mode: "radial" | "linear" | "isolated" | null) => {
      if (!svgRef.current || !clusterData) return;

      const svg = d3.select(svgRef.current);

      // 重置所有节点和连接的样式
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("fill", "#69b3a2")
        .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15));

      svg
        .selectAll<SVGLineElement, GraphLink>(".links line")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", 1);

      if (!mode) return;

      // 根据不同模式高亮显示
      switch (mode) {
        case "radial":
          if (clusterData.radial) {
            // 高亮中心节点
            svg
              .selectAll<SVGCircleElement, GraphNode>(".node circle")
              .attr("fill", (d) =>
                clusterData.radial?.centers.some((c) => c.id === d.id)
                  ? "#ff6b6b"
                  : clusterData.radial?.children.get(d.id)?.length
                  ? "#4ecdc4"
                  : "#ddd"
              )
              .attr("r", (d) =>
                clusterData.radial?.centers.some((c) => c.id === d.id)
                  ? 20
                  : Math.min(Math.sqrt(d.likes) + 3, 15)
              );

            // 高亮连接
            svg
              .selectAll<SVGLineElement, GraphLink>(".links line")
              .attr("stroke", (l) =>
                clusterData.radial?.links.some(
                  (link) => link.source === l.source && link.target === l.target
                )
                  ? "#ff6b6b"
                  : "#ddd"
              )
              .attr("stroke-opacity", (l) =>
                clusterData.radial?.links.some(
                  (link) => link.source === l.source && link.target === l.target
                )
                  ? 1
                  : 0.2
              )
              .attr("stroke-width", (l) =>
                clusterData.radial?.links.some(
                  (link) => link.source === l.source && link.target === l.target
                )
                  ? 2
                  : 1
              );
          }
          break;

        case "linear":
          if (clusterData.linear) {
            const chainNodes = new Set(
              clusterData.linear.chains.flatMap((chain) =>
                chain.nodes.map((n) => n.id)
              )
            );

            const chainLinks = new Set(
              clusterData.linear.chains.flatMap((chain) =>
                chain.links.map((l) => `${l.source}-${l.target}`)
              )
            );

            svg
              .selectAll<SVGCircleElement, GraphNode>(".node circle")
              .attr("fill", (d) => (chainNodes.has(d.id) ? "#4ecdc4" : "#ddd"))
              .attr("r", (d) =>
                chainNodes.has(d.id) ? 12 : Math.min(Math.sqrt(d.likes) + 3, 15)
              );

            svg
              .selectAll<SVGLineElement, GraphLink>(".links line")
              .attr("stroke", (l) =>
                chainLinks.has(`${l.source}-${l.target}`) ? "#4ecdc4" : "#ddd"
              )
              .attr("stroke-opacity", (l) =>
                chainLinks.has(`${l.source}-${l.target}`) ? 1 : 0.2
              )
              .attr("stroke-width", (l) =>
                chainLinks.has(`${l.source}-${l.target}`) ? 2 : 1
              );
          }
          break;

        case "isolated":
          if (clusterData.isolated) {
            const isolatedNodeIds = new Set(
              clusterData.isolated.nodes.map((n) => n.id)
            );

            svg
              .selectAll<SVGCircleElement, GraphNode>(".node circle")
              .attr("fill", (d) =>
                isolatedNodeIds.has(d.id) ? "#ffd93d" : "#ddd"
              )
              .attr("r", (d) =>
                isolatedNodeIds.has(d.id)
                  ? 12
                  : Math.min(Math.sqrt(d.likes) + 3, 15)
              );

            svg
              .selectAll<SVGLineElement, GraphLink>(".links line")
              .attr("stroke", "#ddd")
              .attr("stroke-opacity", 0.2)
              .attr("stroke-width", 1);
          }
          break;
      }
    },
    [clusterData]
  );

  // 更新聚类模式时触发高亮
  useEffect(() => {
    highlightCluster(clusterMode);
  }, [clusterMode, highlightCluster]);

  // 优化折叠/展开逻辑
  const handleTogglePanel = () => {
    setIsControlPanelExpanded((prev) => !prev);
  };

  // 添加聚类控制面板组件
  const ClusterControls = () => (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200/50 p-2 flex space-x-2">
      <button
        onClick={() => {
          handleClusterMode("radial");
          setIsRankingOpen(true);
        }}
        className={` px-4 py-2 rounded-lg transition-all duration-200 ${
          clusterMode === "radial"
            ? "bg-gradient-to-r from-red-500 to-pink-500 text-white"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        中心放射聚类
      </button>
      <button
        onClick={() => {
          handleClusterMode("linear");
          setIsRankingOpen(true);
        }}
        className={`px-4 py-2 rounded-lg transition-all duration-200 ${
          clusterMode === "linear"
            ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        长链线状聚类
      </button>
      <button
        onClick={() => {
          handleClusterMode("isolated");
          setIsRankingOpen(true);
        }}
        className={`px-4 py-2 rounded-lg transition-all duration-200 ${
          clusterMode === "isolated"
            ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-white"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        孤立点集聚类
      </button>
    </div>
  );

  // 添加排行榜组件
  const RankingPanel = () => {
    if (!isRankingOpen || !clusterMode) return null;

    const renderRankingContent = () => {
      switch (clusterMode) {
        case "radial":
          return (
            <div className="space-y-2">
              <h3 className="font-semibold text-lg mb-4 text-gray-700">
                放射状聚类排行
              </h3>
              {rankingData.radial.map((item, index) => (
                <div
                  key={item.node.id}
                  className="p-3 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => locateNode(item.node.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {index + 1}. {item.node.name}
                    </span>
                    <span className="text-sm text-gray-500">
                      {item.childCount} 个子节点
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {item.node.content}
                  </p>
                </div>
              ))}
            </div>
          );

        case "linear":
          return (
            <div className="space-y-2">
              <h3 className="font-semibold text-lg mb-4 text-gray-700">
                线性聚类排行
              </h3>
              {rankingData.linear.map((chain, index) => (
                <div
                  key={index}
                  className="p-3 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => locateNode(chain.nodes[0].id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {index + 1}. {chain.nodes[0].name} →{" "}
                      {chain.nodes[chain.nodes.length - 1].name}
                    </span>
                    <span className="text-sm text-gray-500">
                      {chain.length} 个节点
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {chain.nodes.map((n) => n.name).join(" → ")}
                  </p>
                </div>
              ))}
            </div>
          );

        case "isolated":
          return (
            <div className="space-y-2">
              <h3 className="font-semibold text-lg mb-4 text-gray-700">
                孤立点排行
              </h3>
              {rankingData.isolated.map((node, index) => (
                <div
                  key={node.id}
                  className="p-3 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => locateNode(node.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {index + 1}. {node.name}
                    </span>
                    <span className="text-sm text-gray-500">
                      {node.likes} 点赞
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {node.content}
                  </p>
                </div>
              ))}
            </div>
          );

        default:
          return null;
      }
    };

    return (
      <div className="fixed bottom-4 right-4 w-80 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-4 max-h-[55vh] overflow-y-auto z-50">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-700">聚类排行榜</h2>
          <button
            onClick={() => setIsRankingOpen(false)}
            className="p-2 hover:bg-red-50 rounded-lg text-gray-600 hover:text-red-600 transition-all duration-200"
          >
            ✕
          </button>
        </div>
        {renderRankingContent()}
      </div>
    );
  };

  // 初始化宽高和缩放行为
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (!containerRef.current) return;
      setWidth(containerRef.current.clientWidth);
      setHeight(containerRef.current.clientHeight);
    };

    // 初始化尺寸
    updateDimensions();

    // 创建缩放行为
    zoomRef.current = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        if (!svgRef.current) return;
        d3.select(svgRef.current)
          .select("g.main-group")
          .attr("transform", event.transform);
      });

    // 监听窗口大小变化
    window.addEventListener("resize", updateDimensions);

    return () => {
      window.removeEventListener("resize", updateDimensions);
    };
  }, []);

  // 定位到指定节点
  const locateNode = useCallback(
    (nodeId: string) => {
      if (!svgRef.current || !simulationRef.current || !zoomRef.current) return;

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const svg = d3.select(svgRef.current);

      // 计算新的变换以将节点居中
      const scale = 2;
      const x = width / 2 - node.x! * scale;
      const y = height / 2 - node.y! * scale;

      // 应用变换
      svg
        .transition()
        .duration(750)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(x, y).scale(scale)
        );

      // 高亮节点
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .transition()
        .duration(750)
        .attr("fill", (d) => (d.id === nodeId ? "#ff6b6b" : "#69b3a2"))
        .attr("r", (d) =>
          d.id === nodeId ? 20 : Math.min(Math.sqrt(d.likes) + 3, 15)
        );
    },
    [nodes, width, height]
  );

  // 4. 专研按钮逻辑
  const handleFocusModeToggle = useCallback(() => {
    setIsFocusMode((prev) => {
      if (prev) {
        setFocusNodeId(null);
        setFocusInfo("");
      }
      return !prev;
    });
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-xl font-bold text-gray-900">B站评论可视化图谱</h1>

          {/* 快捷工具栏 - 居中 */}
          <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center space-x-3">
            <div className="bg-gray-50 rounded-lg p-1 flex items-center space-x-1 border border-gray-200">
              <span className="text-xs text-gray-600 px-2">基本操作</span>
              <button
                onClick={handleVisualizationReset}
                className="flex items-center space-x-1 px-3 py-2 bg-white rounded-md hover:bg-blue-50 text-blue-600 transition-all duration-200 border border-transparent hover:border-blue-200"
                title="重置视图"
              >
                <span>↺</span>
                <span className="text-sm font-medium">重置</span>
              </button>
              <button
                onClick={handleFullscreen}
                className="flex items-center space-x-1 px-3 py-2 bg-white rounded-md hover:bg-green-50 text-green-600 transition-all duration-200 border border-transparent hover:border-green-200"
                title="全屏模式"
              >
                <span>⛶</span>
                <span className="text-sm font-medium">全屏</span>
              </button>
              <button
                onClick={handleFocusModeToggle}
                className={`flex items-center space-x-1 px-3 py-2 rounded-md border border-transparent transition-all duration-200 ${
                  isFocusMode
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : "bg-white hover:bg-purple-50 text-purple-600 hover:border-purple-200"
                }`}
                title="专业研究模式"
              >
                <span>🔬</span>
                <span className="text-sm font-medium">专注</span>
              </button>
            </div>
          </div>

          <button
            onClick={onReset}
            className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-all duration-200"
          >
            返回上传
          </button>
        </div>
      </div>

      {/* Sliding Panel Container - handles the animation for the whole unit */}
      <div
        className={`
    fixed top-20 left-0 z-40
    transition-transform duration-500 ease-in-out
    ${isControlPanelExpanded ? "translate-x-0" : "-translate-x-full"}
  `}
      >
        <div
          className="relative w-80 h-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200/50"
          style={{
            minHeight: "300px", // Reduced from 360px
            maxHeight: "70vh", // Reduced from 80vh
            overflow: "visible",
          }}
        >
          {/* Panel Content */}
          <div
            className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-gray-200/50"
            style={{
              borderTopLeftRadius: "1rem",
              borderTopRightRadius: "1rem",
            }}
          >
            <div className="flex justify-between items-center p-1.2">
              <span className="py-2 font-semibold text-gray-800 flex items-center">
                <span className="w-3 h-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full ml-4 mr-2 animate-pulse"></span>
                控制面板
              </span>
            </div>
          </div>

          <div className="p-3 space-y-2 animate-in slide-in-from-left-2 duration-300 bg-gradient-to-b from-white to-gray-50/50">
            {/* Search, filters, etc. */}
            <div className="space-y-2">
              <h3 className="font-medium text-sm text-gray-700 flex items-center">
                <span className="w-3 h-3 bg-blue-500 rounded-full mr-2"></span>
                用户搜索
              </h3>
              <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索用户名..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                    onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-400 text-sm">🔍</span>
                  </div>
                </div>
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 text-purple-700 transition-all duration-200 border border-purple-200"
                  title="搜索"
                >
                  搜索
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t border-gray-200 pt-3">
              <h3 className="font-medium text-sm text-gray-700 flex items-center">
                <span className="w-3 h-3 bg-orange-500 rounded-full mr-2"></span>
                度数筛选
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-gray-600 font-medium">
                    最小度数
                  </label>
                  <input
                    type="number"
                    value={minDegree}
                    onChange={(e) =>
                      setMinDegree(parseInt(e.target.value) || 0)
                    }
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-600 font-medium">
                    最大度数
                  </label>
                  <input
                    type="number"
                    value={maxDegree}
                    onChange={(e) =>
                      setMaxDegree(parseInt(e.target.value) || 0)
                    }
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleDegreeFilter}
                  className="flex-1 py-2 px-4 rounded-lg bg-gradient-to-r from-orange-50 to-orange-100 hover:from-orange-100 hover:to-orange-200 text-orange-700 text-sm font-medium transition-all duration-200 border border-orange-200"
                >
                  应用筛选
                </button>
                <button
                  onClick={handleVisualizationReset}
                  className="px-3 py-2 rounded-lg bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 text-red-700 transition-all duration-200 border border-red-200"
                  title="清除筛选"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          {/* Collapse/Expand Button - attached to the right of the panel */}
          <button
            onClick={handleTogglePanel}
            className={`
        absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2
        bg-gradient-to-b from-blue-100/80 to-purple-100/80
        border border-blue-200/60 border-l-0
        shadow-md
        rounded-r-full
        w-8 h-16 flex items-center justify-center
        left-[303px]
        transition-all duration-500
        hover:bg-blue-200/90
        z-50
      `}
            title={isControlPanelExpanded ? "收起侧栏" : "展开侧栏"}
          >
            <span
              className={`
          text-blue-600 text-lg font-bold transition-transform duration-500
          ${isControlPanelExpanded ? "rotate-180" : ""}
        `}
            >
              ▶
            </span>
          </button>
        </div>
      </div>

      {/* Visualization Container */}
      <div ref={containerRef} className="flex-1 relative">
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ background: "#f8f9fa" }}
        />
      </div>

      {/* Node Detail Modal */}
      <NodeDetailModal
        node={selectedNode}
        isOpen={isModalOpen}
        isCollapsed={isModalCollapsed}
        onClose={() => {
          setIsModalOpen(false);
          setIsModalCollapsed(false);
        }}
        onCollapse={() => setIsModalCollapsed(!isModalCollapsed)}
      />
      <ClusterControls />
      <RankingPanel />

      {/* 专研模式提示 */}
      {isFocusMode && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-6 py-2 bg-blue-50 border border-blue-200 rounded-lg shadow text-blue-700 text-sm animate-in fade-in duration-300">
          {focusNodeId
            ? focusInfo
            : "专研模式已开启：请点击任意节点，显示其所有直接或间接关联的节点网络。"}
          <button
            className="ml-4 px-2 py-1 text-xs rounded bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300 ml-2"
            onClick={handleFocusModeToggle}
          >
            退出专研
          </button>
        </div>
      )}
    </div>
  );
};
