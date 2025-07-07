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

  // 聚类高亮函数 - 保留用于主组件的其他功能
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

  // 3. 通用高亮控制函数
  const applyHighlight = useCallback((type: "reset" | "cluster" | "search" | "locate", options?: {
    clusterMode?: "radial" | "linear" | "isolated" | null;
    searchResults?: GraphNode[];
    targetNodeId?: string;
  }) => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    
    // 首先重置所有样式
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

    if (type === "reset") return;

    // 根据类型应用特定的高亮
    if (type === "cluster" && options?.clusterMode && clusterData) {
      highlightCluster(options.clusterMode);
    } else if (type === "search" && options?.searchResults) {
      // 高亮搜索结果
      svg
        .selectAll<SVGCircleElement, GraphNode>(".node circle")
        .attr("fill", (d) =>
          options.searchResults!.some((t) => t.id === d.id) ? "#ff6b6b" : "#ddd"
        )
        .attr("r", (d) =>
          options.searchResults!.some((t) => t.id === d.id)
            ? 20
            : Math.min(Math.sqrt(d.likes) + 3, 15)
        );
    } else if (type === "locate" && options?.targetNodeId) {
      // 特别标记目标节点
      if (clusterMode) {
        // 如果处于聚类模式，重新应用聚类高亮
        highlightCluster(clusterMode);
        // 然后特别标记目标节点
        svg
          .selectAll<SVGCircleElement, GraphNode>(".node circle")
          .filter((d: GraphNode) => d.id === options.targetNodeId)
          .attr("stroke", "#ff0000")
          .attr("stroke-width", 3);
      } else {
        // 如果不在聚类模式，使用临时高亮
        svg
          .selectAll<SVGCircleElement, GraphNode>(".node circle")
          .attr("fill", (d) => (d.id === options.targetNodeId ? "#ff6b6b" : "#69b3a2"))
          .attr("r", (d) =>
            d.id === options.targetNodeId ? 20 : Math.min(Math.sqrt(d.likes) + 3, 15)
          );
      }
    }
  }, [svgRef, clusterData, clusterMode, highlightCluster]);

  // 更新聚类模式时触发高亮 - 现在由handleClusterMode处理

  // 搜索功能实现
  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;

    const targetNodes = nodes.filter((n) =>
      n.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (targetNodes.length === 0) {
      alert("未找到匹配的节点");
      return;
    }

    // 使用统一的高亮函数
    applyHighlight("search", { searchResults: targetNodes });

    // 定位到第一个匹配的节点（内联定位逻辑）
    if (targetNodes.length > 0) {
      const nodeId = targetNodes[0].id;
      const node = nodes.find((n) => n.id === nodeId);
      if (node && zoomRef.current && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const scale = 2;
        const x = containerRect.width / 2 - (node.x || 0) * scale;
        const y = containerRect.height / 2 - (node.y || 0) * scale;

        const svg = d3.select(svgRef.current!);
        svg
          .transition()
          .duration(750)
          .call(
            zoomRef.current.transform,
            d3.zoomIdentity.translate(x, y).scale(scale)
          );
      }
    }
  }, [searchQuery, nodes, applyHighlight, svgRef, containerRef, zoomRef]);

  // 度数筛选功能
  const handleDegreeFilter = useCallback(() => {
    const filteredNodes = nodes.filter(
      (n) => n.degree >= minDegree && n.degree <= maxDegree
    );

    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

      // 显示/隐藏节点
      svg
        .selectAll<SVGGElement, GraphNode>(".node")
        .style("display", (d) => (filteredNodeIds.has(d.id) ? null : "none"));

      // 显示/隐藏连接
      svg
        .selectAll<SVGLineElement, GraphLink>(".links line")
        .style("display", (l) => {
          const sourceId = typeof l.source === "object" ? l.source.id : l.source;
          const targetId = typeof l.target === "object" ? l.target.id : l.target;
          return filteredNodeIds.has(sourceId) && filteredNodeIds.has(targetId)
            ? null
            : "none";
        });
    }
  }, [nodes, minDegree, maxDegree]);

  // 重置可视化
  const handleVisualizationReset = useCallback(() => {
    // 使用统一的高亮函数重置样式
    applyHighlight("reset");

    if (svgRef.current) {
      const svg = d3.select(svgRef.current);

      // 显示所有节点和连接
      svg.selectAll(".node").style("display", null);
      svg.selectAll(".links line").style("display", null);

      // 重置缩放
      if (zoomRef.current && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        svg
          .transition()
          .duration(750)
          .call(
            zoomRef.current.transform,
            d3.zoomIdentity.translate(
              containerRect.width / 2,
              containerRect.height / 2
            ).scale(1)
          );
      }
    }

    // 重置状态
    setClusterMode(null);
    setSearchQuery("");
    setIsRankingOpen(false);
  }, [applyHighlight, svgRef, zoomRef, containerRef]);

  // 全屏功能
  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  // 定位到指定节点
  const locateNode = useCallback(
    (nodeId: string) => {
      if (!svgRef.current || !zoomRef.current) return;

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      console.log(`定位节点: ${nodeId} (${node.name}), 聚类模式: ${clusterMode}`);

      // 计算新的变换以将节点居中
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      
      const scale = 2;
      const x = containerRect.width / 2 - (node.x || 0) * scale;
      const y = containerRect.height / 2 - (node.y || 0) * scale;

      // 应用变换
      const svg = d3.select(svgRef.current);
      svg
        .transition()
        .duration(750)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(x, y).scale(scale)
        );

      // 延迟应用高亮，确保zoom变换完成
      setTimeout(() => {
        applyHighlight("locate", { targetNodeId: nodeId });
      }, 800); // 等待zoom动画完成
    },
    [nodes, clusterMode, applyHighlight, svgRef, zoomRef, containerRef]
  );

  // 专研按钮逻辑
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
    // 移除这里的applyHighlight调用，让VisualizationCanvas自己处理
  }, [clusterMode]);

  // 优化折叠/展开逻辑
  const handleTogglePanel = () => {
    setIsControlPanelExpanded((prev) => !prev);
  };

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
        svgRef={svgRef}
        containerRef={containerRef}
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
