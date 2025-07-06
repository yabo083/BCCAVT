"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { CommentDataProcessor } from "@/utils/commentDataProcessor";
import { GraphNode, GraphLink } from "@/types/comment";

// 导入拆分的组件
import { VisualizationHeader } from "./visualization/VisualizationHeader";
import { ControlPanel } from "./visualization/ControlPanel";
import { VisualizationCanvas } from "./visualization/VisualizationCanvas";
import { ClusterControls } from "./visualization/ClusterControls";
import { RankingPanel } from "./visualization/RankingPanel";
import { NodeDetailModal } from "./visualization/NodeDetailModal";
import { FocusModeIndicator } from "./visualization/FocusModeIndicator";

interface VisualizationComponentProps {
  processor: CommentDataProcessor;
}

export const VisualizationComponent: React.FC<VisualizationComponentProps> = ({
  processor,
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

        // 在聚类模式下，保持聚类高亮并标记当前点击的节点
        if (clusterMode) {
          console.log(`聚类模式下点击节点: ${d.id} (${d.name})`);
          
          // 实现聚焦功能：缩放并居中到节点
          if (svgRef.current && zoomRef.current && containerRef.current) {
            const svg = d3.select(svgRef.current);
            const containerRect = containerRef.current.getBoundingClientRect();
            
            // 清除之前的所有红色边框高亮
            svg
              .selectAll<SVGCircleElement, GraphNode>(".node circle")
              .attr("stroke", "#fff")
              .attr("stroke-width", 1.5);

            // 计算新的变换以将节点居中
            const scale = 2;
            const x = containerRect.width / 2 - (d.x || 0) * scale;
            const y = containerRect.height / 2 - (d.y || 0) * scale;

            // 应用变换
            svg
              .transition()
              .duration(750)
              .call(
                zoomRef.current.transform,
                d3.zoomIdentity.translate(x, y).scale(scale)
              );

            // 延迟应用高亮，确保zoom变换完成
            setTimeout(() => {
              if (!svgRef.current) return;
              const svg = d3.select(svgRef.current);
              
              // 重新应用聚类高亮逻辑
              switch (clusterMode) {
                case "radial":
                  if (clusterData?.radial) {
                    svg
                      .selectAll<SVGCircleElement, GraphNode>(".node circle")
                      .attr("fill", (node) =>
                        clusterData.radial?.centers.some((c) => c.id === node.id)
                          ? "#ff6b6b"
                          : clusterData.radial?.children.get(node.id)?.length
                          ? "#4ecdc4"
                          : "#ddd"
                      )
                      .attr("r", (node) =>
                        clusterData.radial?.centers.some((c) => c.id === node.id)
                          ? 20
                          : Math.min(Math.sqrt(node.likes) + 3, 15)
                      );
                  }
                  break;
                case "linear":
                  if (clusterData?.linear) {
                    const chainNodes = new Set(
                      clusterData.linear.chains.flatMap((chain) =>
                        chain.nodes.map((n) => n.id)
                      )
                    );
                    svg
                      .selectAll<SVGCircleElement, GraphNode>(".node circle")
                      .attr("fill", (node) => (chainNodes.has(node.id) ? "#4ecdc4" : "#ddd"))
                      .attr("r", (node) =>
                        chainNodes.has(node.id) ? 12 : Math.min(Math.sqrt(node.likes) + 3, 15)
                      );
                  }
                  break;
                case "isolated":
                  if (clusterData?.isolated) {
                    const isolatedNodeIds = new Set(
                      clusterData.isolated.nodes.map((n) => n.id)
                    );
                    svg
                      .selectAll<SVGCircleElement, GraphNode>(".node circle")
                      .attr("fill", (node) =>
                        isolatedNodeIds.has(node.id) ? "#ffd93d" : "#ddd"
                      )
                      .attr("r", (node) =>
                        isolatedNodeIds.has(node.id)
                          ? 12
                          : Math.min(Math.sqrt(node.likes) + 3, 15)
                      );
                  }
                  break;
              }
              
              // 给目标节点额外的强调（红圈）
              svg
                .selectAll<SVGCircleElement, GraphNode>(".node circle")
                .filter((node: GraphNode) => node.id === d.id)
                .attr("stroke", "#ff0000")
                .attr("stroke-width", 3);
            }, 800); // 稍微延迟确保变换完成
          }
          
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
    // 注意：不包含clusterMode和clusterData是有意的，避免重新创建图表
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Reset styles and clear all highlights
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("fill", "#69b3a2")
        .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);

      svg
        .selectAll<SVGLineElement, GraphLink>(".links line")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", 1);

      // 关闭排行榜面板
      setIsRankingOpen(false);

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

        // 显示排行榜
        setIsRankingOpen(true);
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

        // 显示排行榜
        setIsRankingOpen(true);
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

        // 显示排行榜
        setIsRankingOpen(true);
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
    setIsRankingOpen(false);

    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("fill", "#69b3a2")
        .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);

      svg
        .selectAll<SVGLineElement, GraphLink>(".links line")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", 1);
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

      // 重置所有节点和连接的样式，包括清除红色边框
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("fill", "#69b3a2")
        .attr("r", (d) => Math.min(Math.sqrt(d.likes) + 3, 15))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);

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

            // 修复链接识别逻辑，支持双向匹配
            const chainLinks = new Set<string>();
            clusterData.linear.chains.forEach((chain) => {
              chain.links.forEach((l) => {
                const sourceId = typeof l.source === "object" ? l.source.id : l.source.toString();
                const targetId = typeof l.target === "object" ? l.target.id : l.target.toString();
                chainLinks.add(`${sourceId}-${targetId}`);
                chainLinks.add(`${targetId}-${sourceId}`); // 添加反向匹配
              });
            });

            svg
              .selectAll<SVGCircleElement, GraphNode>(".node circle")
              .attr("fill", (d) => (chainNodes.has(d.id) ? "#4ecdc4" : "#ddd"))
              .attr("r", (d) =>
                chainNodes.has(d.id) ? 12 : Math.min(Math.sqrt(d.likes) + 3, 15)
              );

            svg
              .selectAll<SVGLineElement, GraphLink>(".links line")
              .attr("stroke", (l) => {
                const sourceId = typeof l.source === "object" ? l.source.id : l.source.toString();
                const targetId = typeof l.target === "object" ? l.target.id : l.target.toString();
                return chainLinks.has(`${sourceId}-${targetId}`) ? "#4ecdc4" : "#ddd";
              })
              .attr("stroke-opacity", (l) => {
                const sourceId = typeof l.source === "object" ? l.source.id : l.source.toString();
                const targetId = typeof l.target === "object" ? l.target.id : l.target.toString();
                return chainLinks.has(`${sourceId}-${targetId}`) ? 1 : 0.2;
              })
              .attr("stroke-width", (l) => {
                const sourceId = typeof l.source === "object" ? l.source.id : l.source.toString();
                const targetId = typeof l.target === "object" ? l.target.id : l.target.toString();
                return chainLinks.has(`${sourceId}-${targetId}`) ? 2 : 1;
              });
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
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 p-4 flex space-x-3 ring-1 ring-black/5 z-50">
      <div className="flex items-center space-x-2 mr-2">
        <div className="w-2 h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse"></div>
        <span className="text-sm font-semibold text-gray-700">聚类分析</span>
      </div>
      <div className="w-px h-8 bg-gray-200"></div>
      <button
        onClick={() => {
          console.log("中心放射按钮被点击");
          handleClusterMode("radial");
          setIsRankingOpen(true);
        }}
        className={`group px-5 py-2.5 rounded-xl transition-all duration-300 font-medium text-sm shadow-md hover:shadow-lg active:scale-95 ${
          clusterMode === "radial"
            ? "bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-red-200"
            : "bg-white hover:bg-red-50 text-red-600 border border-red-200/50 hover:border-red-300"
        }`}
      >
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m9-9H3" />
          </svg>
          <span>中心放射</span>
        </div>
      </button>
      <button
        onClick={() => {
          console.log("长链线状按钮被点击");
          handleClusterMode("linear");
          setIsRankingOpen(true);
        }}
        className={`group px-5 py-2.5 rounded-xl transition-all duration-300 font-medium text-sm shadow-md hover:shadow-lg active:scale-95 ${
          clusterMode === "linear"
            ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-emerald-200"
            : "bg-white hover:bg-emerald-50 text-emerald-600 border border-emerald-200/50 hover:border-emerald-300"
        }`}
      >
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span>长链线状</span>
        </div>
      </button>
      <button
        onClick={() => {
          console.log("孤立点集按钮被点击");
          handleClusterMode("isolated");
          setIsRankingOpen(true);
        }}
        className={`group px-5 py-2.5 rounded-xl transition-all duration-300 font-medium text-sm shadow-md hover:shadow-lg active:scale-95 ${
          clusterMode === "isolated"
            ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-amber-200"
            : "bg-white hover:bg-amber-50 text-amber-600 border border-amber-200/50 hover:border-amber-300"
        }`}
      >
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <span>孤立点集</span>
        </div>
      </button>
    </div>
  );

  // 添加排行榜组件
  const RankingPanel = () => {
    if (!isRankingOpen || !clusterMode) return null;

    // 根据节点详情模态框的状态计算位置和高度
    const getPositionStyle = () => {
      if (!isModalOpen) {
        // 节点详情未打开时，排行榜占据更大空间
        return {
          top: '6rem',
          height: 'calc(100vh - 9rem)'
        };
      } else if (isModalCollapsed) {
        // 节点详情收起时，从收起框的下方开始
        return {
          top: 'calc(6rem + 3.5rem + 1rem)', // 顶部栏 + 收起的模态框高度 + 间距
          height: 'calc(100vh - 12.5rem)'
        };
      } else {
        // 节点详情展开时，从屏幕中间开始
        return {
          top: 'calc(50vh + 1.5rem)',
          height: 'calc((100vh - 7rem) / 2 - 1rem)'
        };
      }
    };

    const renderRankingContent = () => {
      switch (clusterMode) {
        case "radial":
          return (
            <div className="space-y-2">
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-pink-500 rounded-lg flex items-center justify-center shadow-md">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m9-9H3" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium text-base text-gray-800">放射状聚类</h3>
                  <p className="text-xs text-gray-500">按影响力排序的中心节点</p>
                </div>
              </div>
              {rankingData.radial.map((item, index) => (
                <div
                  key={item.node.id}
                  className="group p-3 bg-gradient-to-r from-white to-red-50/30 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-red-100/50 hover:border-red-200 hover:scale-[1.01]"
                  onClick={() => locateNode(item.node.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                        {index + 1}
                      </div>
                      <span className="font-medium text-gray-900 group-hover:text-red-600 transition-colors text-sm">
                        {item.node.name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 text-xs text-red-600 bg-red-50 rounded-full px-2 py-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="font-medium">{item.childCount}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-1 leading-relaxed">
                    {item.node.content}
                  </p>
                </div>
              ))}
            </div>
          );

        case "linear":
          return (
            <div className="space-y-2">
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center shadow-md">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium text-base text-gray-800">线性聚类</h3>
                  <p className="text-xs text-gray-500">按长度排序的连接链</p>
                </div>
              </div>
              {rankingData.linear.map((chain, index) => (
                <div
                  key={index}
                  className="group p-3 bg-gradient-to-r from-white to-emerald-50/30 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-emerald-100/50 hover:border-emerald-200 hover:scale-[1.01]"
                  onClick={() => locateNode(chain.nodes[0].id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                        {index + 1}
                      </div>
                      <span className="font-medium text-gray-900 group-hover:text-emerald-600 transition-colors text-sm truncate">
                        {chain.nodes[0].name} → {chain.nodes[chain.nodes.length - 1].name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 text-xs text-emerald-600 bg-emerald-50 rounded-full px-2 py-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <span className="font-medium">{chain.length}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 truncate">
                    {chain.nodes.map((n) => n.name).join(" → ")}
                  </p>
                </div>
              ))}
            </div>
          );

        case "isolated":
          return (
            <div className="space-y-2">
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg flex items-center justify-center shadow-md">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium text-base text-gray-800">孤立节点</h3>
                  <p className="text-xs text-gray-500">按点赞数排序的独立节点</p>
                </div>
              </div>
              {rankingData.isolated.map((node, index) => (
                <div
                  key={node.id}
                  className="group p-3 bg-gradient-to-r from-white to-amber-50/30 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-amber-100/50 hover:border-amber-200 hover:scale-[1.01]"
                  onClick={() => locateNode(node.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-yellow-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                        {index + 1}
                      </div>
                      <span className="font-medium text-gray-900 group-hover:text-amber-600 transition-colors text-sm">
                        {node.name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 text-xs text-amber-600 bg-amber-50 rounded-full px-2 py-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      <span className="font-medium">{node.likes}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-1 leading-relaxed">
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
      <div 
        className="fixed right-6 w-80 bg-white/98 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 p-4 z-40 ring-1 ring-black/5 overflow-y-auto transition-all duration-500 ease-out" 
        style={getPositionStyle()}
      >
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse"></div>
            <h2 className="text-lg font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
              聚类排行榜
            </h2>
          </div>
          <button
            onClick={() => setIsRankingOpen(false)}
            className="group p-2 hover:bg-red-50 rounded-xl text-gray-500 hover:text-red-500 transition-all duration-300 transform hover:scale-110 active:scale-95"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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
      // 这里不再需要设置width和height状态
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
      if (!svgRef.current || !zoomRef.current) return;

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const svg = d3.select(svgRef.current);

      console.log(`定位节点: ${nodeId} (${node.name}), 聚类模式: ${clusterMode}`);

      // 清除之前的所有红色边框高亮
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);

      // 计算新的变换以将节点居中
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      
      const scale = 2;
      const x = containerRect.width / 2 - (node.x || 0) * scale;
      const y = containerRect.height / 2 - (node.y || 0) * scale;

      // 应用变换
      svg
        .transition()
        .duration(750)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(x, y).scale(scale)
        );

      // 延迟应用高亮，确保zoom变换完成
      setTimeout(() => {
        if (!svgRef.current) return;
        const svg = d3.select(svgRef.current);
        
        // 高亮节点 - 保持聚类状态或使用临时高亮
        if (clusterMode) {
          // 如果处于聚类模式，重新应用聚类高亮并特别标记目标节点
          switch (clusterMode) {
            case "radial":
              if (clusterData?.radial) {
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
              }
              break;
            case "linear":
              if (clusterData?.linear) {
                const chainNodes = new Set(
                  clusterData.linear.chains.flatMap((chain) =>
                    chain.nodes.map((n) => n.id)
                  )
                );
                svg
                  .selectAll<SVGCircleElement, GraphNode>(".node circle")
                  .attr("fill", (d) => (chainNodes.has(d.id) ? "#4ecdc4" : "#ddd"))
                  .attr("r", (d) =>
                    chainNodes.has(d.id) ? 12 : Math.min(Math.sqrt(d.likes) + 3, 15)
                  );
              }
              break;
            case "isolated":
              if (clusterData?.isolated) {
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
              }
              break;
          }
          
          // 在聚类高亮的基础上，给目标节点额外的强调
          svg
            .selectAll<SVGCircleElement, GraphNode>(".node circle")
            .filter((d: GraphNode) => d.id === nodeId)
            .attr("stroke", "#ff0000")
            .attr("stroke-width", 3);
        } else {
          // 如果不在聚类模式，使用临时高亮
          svg
            .selectAll<SVGCircleElement, GraphNode>(".node circle")
            .transition()
            .duration(300)
            .attr("fill", (d) => (d.id === nodeId ? "#ff6b6b" : "#69b3a2"))
            .attr("r", (d) =>
              d.id === nodeId ? 20 : Math.min(Math.sqrt(d.likes) + 3, 15)
            );
        }
      }, 800); // 等待zoom动画完成
    },
    [nodes, clusterMode, clusterData]
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

  // 节点点击处理函数
  const handleNodeClick = useCallback((node: GraphNode) => {
    if (isFocusMode) {
      setFocusNodeId(node.id);
      setFocusInfo(
        `专研模式：已显示与"${node.name}"相关的${
          findConnectedComponent(node.id).size
        }个节点`
      );
      return;
    }

    // 普通模式下打开节点详情模态框
    setSelectedNode(node);
    setIsModalOpen(true);
  }, [isFocusMode, findConnectedComponent]);

  // 聚类模式切换处理函数
  const handleClusterMode = useCallback((mode: "radial" | "linear" | "isolated") => {
    const newMode = clusterMode === mode ? null : mode;
    setClusterMode(newMode);
    highlightCluster(newMode);
  }, [clusterMode, highlightCluster]);

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
      {/* 顶部标题栏 */}
      <VisualizationHeader
        nodeCount={nodes.length}
        linkCount={links.length}
        onReset={handleVisualizationReset}
        onFullscreen={handleFullscreen}
        onFocusModeToggle={handleFocusModeToggle}
        isFocusMode={isFocusMode}
      />

      {/* 左侧控制面板 */}
      <ControlPanel
        isExpanded={isControlPanelExpanded}
        onToggle={handleTogglePanel}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearch={handleSearch}
        minDegree={minDegree}
        maxDegree={maxDegree}
        onMinDegreeChange={setMinDegree}
        onMaxDegreeChange={setMaxDegree}
        onDegreeFilter={handleDegreeFilter}
        onReset={handleVisualizationReset}
      />

      {/* 主要可视化画布 */}
      <VisualizationCanvas
        nodes={nodes}
        links={links}
        isFocusMode={isFocusMode}
        focusNodeId={focusNodeId}
        onNodeClick={handleNodeClick}
        clusterMode={clusterMode}
        isModalOpen={isModalOpen}
        clusterData={clusterData}
        simulationRef={simulationRef}
        zoomRef={zoomRef}
        findConnectedComponent={findConnectedComponent}
      />

      {/* 底部聚类控制 */}
      <ClusterControls
        clusterMode={clusterMode}
        onClusterModeChange={handleClusterMode}
        onRankingOpen={() => setIsRankingOpen(true)}
      />

      {/* 右侧排行榜 */}
      <RankingPanel
        isOpen={isRankingOpen}
        clusterMode={clusterMode}
        rankingData={rankingData}
        onClose={() => setIsRankingOpen(false)}
        onNodeLocate={locateNode}
        isModalOpen={isModalOpen}
        isModalCollapsed={isModalCollapsed}
      />

      {/* 节点详情弹窗 */}
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

      {/* 专研模式提示 */}
      {isFocusMode && (
        <FocusModeIndicator
          focusNodeId={focusNodeId}
          focusInfo={focusInfo}
          onExit={handleFocusModeToggle}
        />
      )}
    </div>
  );
};
