import { GraphData, GraphNode, GraphLink, CommentStats } from '@/types/comment';

interface RawComment {
  评论ID: number;
  用户名: string;
  评论内容: string;
  点赞数: number;
  回复时间: string;
  父评论ID: number;
  replies: RawComment[];
}

export class CommentDataProcessor {
  private rawData: RawComment[];
  private graphData: GraphData;
  private stats: CommentStats;
  private nodeDegrees: Map<string, number> = new Map();
  private minDegree: number = 0;
  private maxDegree: number = 0;
  private avgDegree: number = 0;

  constructor(data: RawComment[]) {
    // 数据验证
    if (!data || !Array.isArray(data)) {
      throw new Error('输入数据必须是一个数组');
    }

    // 验证每个评论对象的必要字段
    this.validateComments(data);

    this.rawData = data;
    this.graphData = { nodes: [], links: [] };
    this.stats = this.initStats();
    this.processData();
  }

  private validateComments(comments: RawComment[], parentId: number = 0): void {
    comments.forEach((comment, index) => {
      if (!comment || typeof comment !== 'object') {
        throw new Error(`第 ${index + 1} 条评论数据格式无效`);
      }

      const requiredFields = {
        '评论ID': 'number',
        '用户名': 'string',
        '评论内容': 'string',
        '点赞数': 'number',
        '回复时间': 'string',
        '父评论ID': 'number',
        'replies': 'object'
      };

      // 验证字段类型
      for (const [field, type] of Object.entries(requiredFields)) {
        if (!(field in comment) || typeof comment[field as keyof RawComment] !== type) {
          throw new Error(`第 ${index + 1} 条评论的 ${field} 字段格式无效`);
        }
      }

      // 验证父评论ID的合法性
      if (comment.父评论ID !== parentId) {
        throw new Error(`第 ${index + 1} 条评论的父评论ID与实际层级不符`);
      }

      // 递归验证回复评论
      if (Array.isArray(comment.replies)) {
        this.validateComments(comment.replies, comment.评论ID);
      }
    });
  }

  private initStats(): CommentStats {
    return {
      totalComments: 0,
      totalUsers: 0,
      averageCommentLength: 0,
      totalLikes: 0,
      averageLikes: 0,
      replyRate: 0,
      earliestComment: Infinity,
      latestComment: 0,
      commentPeriod: 0,
    };
  }

  private processData() {
    const userMap = new Map<string, string>();
    const nodeMap = new Map<string, GraphNode>();
    const uniqueUsers = new Set<string>();
    let totalLength = 0;
    let totalLikes = 0;
    let repliesCount = 0;

    // 递归处理评论及其回复
    const processComment = (comment: RawComment) => {
      // 更新统计信息
      this.stats.totalComments++;
      totalLength += comment.评论内容.length;
      totalLikes += comment.点赞数;
      uniqueUsers.add(comment.用户名);

      // 解析时间
      const timestamp = new Date(comment.回复时间.replace(/(\d{6})-(\d{2})/, '$1-$2')).getTime() / 1000;
      this.stats.earliestComment = Math.min(this.stats.earliestComment, timestamp);
      this.stats.latestComment = Math.max(this.stats.latestComment, timestamp);

      // 创建或更新节点
      const nodeId = comment.评论ID.toString();
      const node: GraphNode = {
        id: nodeId,
        name: comment.用户名,
        likes: comment.点赞数,
        degree: 0,
        content: comment.评论内容,
        time: timestamp,
        root: comment.父评论ID === 0
      };

      nodeMap.set(nodeId, node);
      userMap.set(comment.用户名, nodeId);

      // 创建连接
      if (comment.父评论ID !== 0) {
        repliesCount++;
        this.graphData.links.push({
          source: comment.父评论ID.toString(),
          target: nodeId,
          value: 1
        });
      }

      // 处理回复
      comment.replies.forEach(reply => processComment(reply));
    };

    // 处理所有顶级评论
    this.rawData.forEach(comment => processComment(comment));

    // === 补全所有出现在links中的节点 ===
    this.graphData.links.forEach(link => {
      const sourceId = link.source.toString();
      const targetId = link.target.toString();
      if (!nodeMap.has(sourceId)) {
        nodeMap.set(sourceId, {
          id: sourceId,
          name: '',
          likes: 0,
          degree: 0,
          content: '',
          time: 0,
          root: false
        });
      }
      if (!nodeMap.has(targetId)) {
        nodeMap.set(targetId, {
          id: targetId,
          name: '',
          likes: 0,
          degree: 0,
          content: '',
          time: 0,
          root: false
        });
      }
    });
    // === 补全结束 ===

    // 计算最终统计数据
    this.stats.totalUsers = uniqueUsers.size;
    this.stats.averageCommentLength = totalLength / this.stats.totalComments;
    this.stats.totalLikes = totalLikes;
    this.stats.averageLikes = totalLikes / this.stats.totalComments;
    this.stats.replyRate = repliesCount / this.stats.totalComments;
    this.stats.commentPeriod = Math.ceil(
      (this.stats.latestComment - this.stats.earliestComment) / (24 * 60 * 60)
    );

    // 计算节点度数（此时nodeMap已完整）
    this.calculateDegrees(nodeMap);

    // 保存处理后的数据（此时degree已赋值）
    this.graphData.nodes = Array.from(nodeMap.values());
  }

  private calculateDegrees(nodeMap: Map<string, GraphNode>) {
    this.nodeDegrees.clear();
    
    // 初始化所有节点的度数为0
    nodeMap.forEach((_, id) => {
      this.nodeDegrees.set(id, 0);
    });

    // 计算每个节点的度数（入度 + 出度）
    this.graphData.links.forEach(link => {
      const sourceId = link.source.toString();
      const targetId = link.target.toString();
      
      this.nodeDegrees.set(
        sourceId,
        (this.nodeDegrees.get(sourceId) || 0) + 1
      );
      this.nodeDegrees.set(
        targetId,
        (this.nodeDegrees.get(targetId) || 0) + 1
      );
    });

    // 更新节点的度数属性
    nodeMap.forEach((node, id) => {
      node.degree = this.nodeDegrees.get(id) || 0;
    });

    // 计算最小、最大和平均度数
    const degrees = Array.from(this.nodeDegrees.values());
    this.minDegree = Math.min(...degrees);
    this.maxDegree = Math.max(...degrees);
    this.avgDegree = degrees.reduce((sum, deg) => sum + deg, 0) / degrees.length;
  }

  // 获取节点度数信息
  public getDegreeStats() {
    return {
      minDegree: this.minDegree,
      maxDegree: this.maxDegree,
      avgDegree: this.avgDegree
    };
  }

  // 识别放射状聚类
  public findRadialClusters(): {
    centers: GraphNode[];
    children: Map<string, GraphNode[]>;
    links: GraphLink[];
  } {
    const degreeThreshold = Math.max(5, this.avgDegree * 2);
    let centers = this.graphData.nodes.filter(node => node.degree >= degreeThreshold);
    
    // 如果没有找到中心节点，使用度数最高的前3个节点
    if (centers.length === 0) {
      centers = [...this.graphData.nodes]
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 3);
    }

    const childrenMap = new Map<string, GraphNode[]>();
    const radialLinks: GraphLink[] = [];
    const centerIds = new Set(centers.map(c => c.id));

    centers.forEach(center => {
      const centerChildren: GraphNode[] = [];
      
      // 查找与中心节点直接相连的节点，但排除其他中心节点
      this.graphData.links.forEach(link => {
        const sourceId = link.source.toString();
        const targetId = link.target.toString();
        
        if (sourceId === center.id) {
          const targetNode = this.graphData.nodes.find(n => n.id === targetId);
          if (targetNode && !centerIds.has(targetNode.id)) {
            centerChildren.push(targetNode);
            radialLinks.push(link);
          }
        } else if (targetId === center.id) {
          const sourceNode = this.graphData.nodes.find(n => n.id === sourceId);
          if (sourceNode && !centerIds.has(sourceNode.id)) {
            centerChildren.push(sourceNode);
            radialLinks.push(link);
          }
        }
      });
      
      childrenMap.set(center.id, centerChildren);
    });

    return {
      centers,
      children: childrenMap,
      links: radialLinks
    };
  }

  // 识别线性聚类
  public findLinearClusters(): {
    chains: { nodes: GraphNode[]; links: GraphLink[] }[];
  } {
    const chains: { nodes: GraphNode[]; links: GraphLink[] }[] = [];
    const visitedNodes = new Set<string>();

    // 查找可能的线性结构起点（度数为1的节点）
    const startNodes = this.graphData.nodes.filter(node => node.degree === 1);

    startNodes.forEach(startNode => {
      if (!visitedNodes.has(startNode.id)) {
        const chain = this.traceLinearChain(startNode.id, visitedNodes);
        if (chain.nodes.length >= 3) { // 只保留长度大于等于3的链
          chains.push(chain);
        }
      }
    });

    return { chains };
  }

  // 识别孤立节点（参考v2实现）
  public findIsolatedNodes(): {
    nodes: GraphNode[];
    links: GraphLink[];
  } {
    // v2中孤立节点是度数为0或1的节点（低连接度点）
    const isolatedNodes = this.graphData.nodes.filter(node => node.degree === 0);
    const isolatedNodeIds = new Set(isolatedNodes.map(n => n.id));
    
    const isolatedLinks = this.graphData.links.filter(link => {
      const sourceId = link.source.toString();
      const targetId = link.target.toString();
      return isolatedNodeIds.has(sourceId) || isolatedNodeIds.has(targetId);
    });

    return {
      nodes: isolatedNodes,
      links: isolatedLinks
    };
  }

  private findDirectConnections(nodeId: string): {
    nodes: GraphNode[];
    links: GraphLink[];
  } {
    const connectedNodes: GraphNode[] = [];
    const connectedLinks: GraphLink[] = [];

    this.graphData.links.forEach(link => {
      if (link.source.toString() === nodeId) {
        const targetNode = this.graphData.nodes.find(n => n.id === link.target.toString());
        if (targetNode) {
          connectedNodes.push(targetNode);
          connectedLinks.push(link);
        }
      } else if (link.target.toString() === nodeId) {
        const sourceNode = this.graphData.nodes.find(n => n.id === link.source.toString());
        if (sourceNode) {
          connectedNodes.push(sourceNode);
          connectedLinks.push(link);
        }
      }
    });

    return {
      nodes: connectedNodes,
      links: connectedLinks
    };
  }

  private traceLinearChain(
    startNodeId: string,
    visitedNodes: Set<string>
  ): {
    nodes: GraphNode[];
    links: GraphLink[];
  } {
    const chainNodes: GraphNode[] = [];
    const chainLinks: GraphLink[] = [];
    let currentNodeId = startNodeId;
    visitedNodes.add(startNodeId);

    const startNode = this.graphData.nodes.find(n => n.id === startNodeId);
    if (startNode) {
      chainNodes.push(startNode);
    }

    let continueTracing = true;
    while (continueTracing) {
      continueTracing = false;
      
      // 查找与当前节点相连的下一个节点
      for (const link of this.graphData.links) {
        const sourceId = link.source.toString();
        const targetId = link.target.toString();
        
        let nextNodeId: string | null = null;
        
        // 如果当前节点是源节点，目标节点是下一个
        if (sourceId === currentNodeId && !visitedNodes.has(targetId)) {
          nextNodeId = targetId;
          chainLinks.push(link);
        }
        // 如果当前节点是目标节点，源节点是下一个
        else if (targetId === currentNodeId && !visitedNodes.has(sourceId)) {
          nextNodeId = sourceId;
          chainLinks.push(link);
        }
        
        if (nextNodeId) {
          const nextNode = this.graphData.nodes.find(n => n.id === nextNodeId);
          if (nextNode) {
            // 检查下一个节点的度数，确保它是链的一部分
            const nextNodeDegree = nextNode.degree;
            
            // 度数为2的节点是链中间的节点，度数为1的节点可能是链的终点
            if (nextNodeDegree <= 2) {
              chainNodes.push(nextNode);
              visitedNodes.add(nextNodeId);
              currentNodeId = nextNodeId;
              continueTracing = true;
              break;
            }
          }
        }
      }
    }

    return {
      nodes: chainNodes,
      links: chainLinks
    };
  }

  public getGraphData(): GraphData {
    return this.graphData;
  }

  public getStats(): CommentStats {
    return this.stats;
  }

  public filterByDegree(min: number, max: number): GraphData {
    const filteredNodes = this.graphData.nodes.filter(
      node => node.degree >= min && node.degree <= max
    );
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    
    const filteredLinks = this.graphData.links.filter(
      link => 
        nodeIds.has(link.source.toString()) && 
        nodeIds.has(link.target.toString())
    );

    return {
      nodes: filteredNodes,
      links: filteredLinks
    };
  }

  public searchByUsername(query: string): GraphNode | null {
    return this.graphData.nodes.find(
      node => node.name.toLowerCase().includes(query.toLowerCase())
    ) || null;
  }
}
