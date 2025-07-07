"use client";

import React, { useEffect } from "react";
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
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
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
  svgRef,
  containerRef,
  findConnectedComponent,
}) => {

  // 用于跟踪当前高亮的节点ID
  const [highlightedNodeId, setHighlightedNodeId] = React.useState<string | null>(null);
  
  // 用于防止频繁缩放的节流
  const [isZooming, setIsZooming] = React.useState(false);

  // 当聚类模式切换时，清除高亮状态
  useEffect(() => {
    setHighlightedNodeId(null);
  }, [clusterMode]);

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
        // 阻止事件冒泡，避免影响仿真
        event.stopPropagation();
        
        // 更新高亮节点状态
        setHighlightedNodeId(d.id);
        
        if (isFocusMode) {
          onNodeClick(d);
          d3.selectAll(".tooltip").remove();
          return;
        }

        // 实现智能聚焦功能：只在必要时缩放
        if (svgRef.current && zoomRef.current && containerRef.current && !isZooming) {
          const svg = d3.select(svgRef.current);
          const containerRect = containerRef.current.getBoundingClientRect();
          
          // 获取当前的变换状态
          const currentTransform = d3.zoomTransform(svgRef.current);
          const currentScale = currentTransform.k;
          
          // 计算节点在当前变换下的屏幕位置
          const nodeScreenX = currentTransform.applyX(d.x || 0);
          const nodeScreenY = currentTransform.applyY(d.y || 0);
          
          // 计算节点距离屏幕中心的距离
          const centerX = containerRect.width / 2;
          const centerY = containerRect.height / 2;
          const distanceFromCenter = Math.sqrt(
            Math.pow(nodeScreenX - centerX, 2) + Math.pow(nodeScreenY - centerY, 2)
          );
          
          // 只有当节点距离中心较远或缩放比例较小时才进行缩放
          const shouldZoom = distanceFromCenter > 100 || currentScale < 1.5;
          
          if (shouldZoom) {
            setIsZooming(true);
            
            // 计算新的变换以将节点居中
            const targetScale = Math.max(currentScale * 1.2, 2);
            const x = centerX - (d.x || 0) * targetScale;
            const y = centerY - (d.y || 0) * targetScale;

            // 应用变换
            svg
              .transition()
              .duration(500)
              .call(
                zoomRef.current.transform,
                d3.zoomIdentity.translate(x, y).scale(targetScale)
              )
              .on("end", () => {
                setIsZooming(false);
                // 缩放完成后，轻微调整仿真以保持稳定
                if (simulation.alpha() < 0.01) {
                  simulation.alpha(0.01).restart();
                  setTimeout(() => {
                    simulation.alphaTarget(0);
                  }, 100);
                }
              });
          }
        }
        
        // 普通模式下也调用onNodeClick
        if (!clusterMode) {
          onNodeClick(d);
        }
        
        d3.selectAll(".tooltip").remove();
      });

    // Create simulation with improved stability
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(80)
          .strength(0.5) // 降低连接力度，减少抖动
      )
      .force("charge", d3.forceManyBody().strength(-100))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(20))
      .alphaDecay(0.01) // 降低衰减率，让仿真更稳定
      .alphaMin(0.001); // 设置更低的最小alpha值

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x || 0)
        .attr("y1", (d) => (d.source as GraphNode).y || 0)
        .attr("x2", (d) => (d.target as GraphNode).x || 0)
        .attr("y2", (d) => (d.target as GraphNode).y || 0);

      nodeGroup.attr("transform", (d) => `translate(${d.x || 0},${d.y || 0})`);
    });

    simulationRef.current = simulation;

    // Drag behavior - 进一步优化稳定性
    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        // 更保守的仿真重启策略
        if (!event.active && simulation.alpha() < 0.05) {
          simulation.alphaTarget(0.05).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        // 快速停止仿真避免持续运动
        if (!event.active) simulation.alphaTarget(0);
        // 释放固定约束
        d.fx = null;
        d.fy = null;
      });

    // 应用拖拽行为，使用正确的类型断言
    (nodeGroup as d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>).call(drag);

    return () => {
      simulation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, isFocusMode, focusNodeId, onNodeClick, findConnectedComponent, simulationRef, zoomRef, containerRef, svgRef]);

  // 单独的effect处理聚类高亮，避免重新创建仿真
  useEffect(() => {
    if (!svgRef.current || !clusterData) return;
    
    const svg = d3.select(svgRef.current);
    
    // 应用聚类高亮
    if (clusterMode) {
      switch (clusterMode) {
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
                chainLinks.add(`${targetId}-${sourceId}`);
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
    } else {
      // 重置到默认样式
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
  }, [clusterMode, clusterData, svgRef]);

  // 处理高亮节点的红圈显示（通用机制）
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    
    // 重置所有节点的stroke
    svg
      .selectAll<SVGCircleElement, GraphNode>(".node circle")
      .attr("stroke", (d) => {
        // 在focus模式下保持原有的逻辑
        if (isFocusMode && focusNodeId) {
          const focusSet = findConnectedComponent(focusNodeId);
          return d.id === focusNodeId
            ? "#fff"
            : focusSet.has(d.id)
            ? "#fff"
            : "#fff";
        }
        return "#fff";
      })
      .attr("stroke-width", 1.5);

    // 为高亮节点添加红圈
    if (highlightedNodeId) {
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .filter((node: GraphNode) => node.id === highlightedNodeId)
        .attr("stroke", "#ff0000")
        .attr("stroke-width", 3);
    }
  }, [highlightedNodeId, isFocusMode, focusNodeId, findConnectedComponent, svgRef]);

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
