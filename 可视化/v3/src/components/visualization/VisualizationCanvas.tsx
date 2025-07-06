"use client";

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { GraphNode, GraphLink } from "@/types/comment";

interface VisualizationCanvasProps {
  nodes: GraphNode[];
  links: GraphLink[];
  isFocusMode: boolean;
  focusNodeId: string | null;
  onNodeClick: (node: GraphNode) => void;
  clusterMode: "radial" | "linear" | "isolated" | null;
  isModalOpen: boolean;
  clusterData: {
    radial: {
      centers: GraphNode[];
      children: Map<string, GraphNode[]>;
      links: GraphLink[];
    } | null;
    linear: { chains: { nodes: GraphNode[]; links: GraphLink[] }[] } | null;
    isolated: { nodes: GraphNode[]; links: GraphLink[] } | null;
  };
  simulationRef: React.MutableRefObject<d3.Simulation<GraphNode, GraphLink> | null>;
  zoomRef: React.MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  findConnectedComponent: (startId: string) => Set<string>;
}

export const VisualizationCanvas: React.FC<VisualizationCanvasProps> = ({
  nodes,
  links,
  isFocusMode,
  focusNodeId,
  onNodeClick,
  clusterMode,
  isModalOpen,
  clusterData,
  simulationRef,
  zoomRef,
  findConnectedComponent,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // D3 可视化逻辑
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
    zoomRef.current = zoom;

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
          onNodeClick(d);
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

        // 普通模式下的点击处理
        onNodeClick(d);
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
          .distance(80)
      )
      .force("charge", d3.forceManyBody().strength(-100))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(20));

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x || 0)
        .attr("y1", (d) => (d.source as GraphNode).y || 0)
        .attr("x2", (d) => (d.target as GraphNode).x || 0)
        .attr("y2", (d) => (d.target as GraphNode).y || 0);

      nodeGroup.attr("transform", (d) => `translate(${d.x || 0},${d.y || 0})`);
    });

    simulationRef.current = simulation;

    // Drag behavior
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

    // 应用拖拽行为，使用正确的类型断言
    (nodeGroup as d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>).call(drag);

    return () => {
      simulation.stop();
    };
  }, [nodes, links, isFocusMode, focusNodeId, isModalOpen, clusterMode, clusterData, onNodeClick, findConnectedComponent, simulationRef, zoomRef]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 25% 25%, rgba(99, 102, 241, 0.1) 0%, transparent 50%),
                           radial-gradient(circle at 75% 75%, rgba(168, 85, 247, 0.1) 0%, transparent 50%),
                           radial-gradient(circle at 75% 25%, rgba(236, 72, 153, 0.1) 0%, transparent 50%),
                           radial-gradient(circle at 25% 75%, rgba(14, 165, 233, 0.1) 0%, transparent 50%)`
        }}></div>
      </div>
      <svg
        ref={svgRef}
        className="w-full h-full relative z-10"
        style={{ background: "transparent" }}
      />
    </div>
  );
};
