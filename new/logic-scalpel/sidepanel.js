const state = {
  replies: new Map(),
  roots: [],
  isolated: [],
  selectedId: null
};

const graphContainer = document.getElementById('graph');
const statsElement = document.getElementById('stats');
const selectedInfo = document.getElementById('selected-info');
const diagnoseButton = document.getElementById('diagnose-button');

const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
tooltip.style.opacity = '0';
graphContainer.appendChild(tooltip);

let svg;
let simulation;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'bili-replies') {
    return;
  }

  const replies = message.payload?.replies ?? [];
  replies.forEach((reply) => {
    if (!reply?.rpid) {
      return;
    }
    state.replies.set(reply.rpid, normalizeReply(reply));
  });

  rebuildTree();
  renderGraph();
  updateStats(message.payload?.page);
});

function normalizeReply(reply) {
  return {
    id: reply.rpid,
    parent: reply.parent ?? 0,
    root: reply.root ?? reply.rpid,
    user: reply.member?.uname ?? '匿名',
    message: reply.content?.message ?? '',
    like: reply.like ?? 0
  };
}

function rebuildTree() {
  const replies = Array.from(state.replies.values());
  const { roots, isolated } = transformToTree(replies);
  state.roots = roots;
  state.isolated = isolated;
}

function transformToTree(replies) {
  const nodeMap = new Map();
  replies.forEach((reply) => {
    nodeMap.set(reply.id, { ...reply, children: [] });
  });

  const roots = [];
  const isolated = [];

  nodeMap.forEach((node) => {
    const parentId = node.parent && node.parent !== 0 ? node.parent : null;
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId).children.push(node);
    } else if (!parentId || node.root === node.id) {
      roots.push(node);
    } else {
      isolated.push(node);
    }
  });

  return { roots, isolated };
}

function flattenTree(nodes) {
  const flatNodes = [];
  const links = [];

  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    flatNodes.push(node);
    node.children.forEach((child) => {
      links.push({ source: node.id, target: child.id });
      stack.push(child);
    });
  }

  return { flatNodes, links };
}

function renderGraph() {
  const { flatNodes, links } = flattenTree([...state.roots, ...state.isolated]);

  if (!svg) {
    const { width, height } = graphContainer.getBoundingClientRect();
    svg = d3
      .select('#graph')
      .append('svg')
      .attr('width', width)
      .attr('height', height);
  }

  const { width, height } = graphContainer.getBoundingClientRect();
  svg.attr('width', width).attr('height', height);

  svg.selectAll('*').remove();

  const linkGroup = svg.append('g').attr('stroke', 'rgba(66, 232, 255, 0.45)').attr('stroke-width', 1.2);
  const nodeGroup = svg.append('g');

  const link = linkGroup
    .selectAll('line')
    .data(links)
    .enter()
    .append('line')
    .attr('marker-end', 'url(#arrow)');

  svg
    .append('defs')
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 16)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', 'rgba(66, 232, 255, 0.7)');

  const node = nodeGroup
    .selectAll('circle')
    .data(flatNodes)
    .enter()
    .append('circle')
    .attr('r', (d) => Math.max(6, Math.log(d.like + 2) * 6))
    .attr('fill', (d) => (d.id === state.selectedId ? '#42e8ff' : '#2f8dff'))
    .attr('stroke', '#0c0f1a')
    .attr('stroke-width', 2)
    .on('mouseenter', (event, d) => {
      tooltip.style.opacity = '1';
      tooltip.textContent = d.message || '（无内容）';
      tooltip.style.left = `${event.offsetX + 12}px`;
      tooltip.style.top = `${event.offsetY + 12}px`;
    })
    .on('mouseleave', () => {
      tooltip.style.opacity = '0';
    })
    .on('click', (event, d) => {
      state.selectedId = d.id;
      updateSelected(d);
      renderGraph();
    });

  simulation?.stop();
  simulation = d3
    .forceSimulation(flatNodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(60))
    .force('charge', d3.forceManyBody().strength(-180))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius((d) => Math.max(12, Math.log(d.like + 2) * 6 + 4)));

  simulation.on('tick', () => {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
  });
}

function updateSelected(node) {
  if (!node) {
    selectedInfo.textContent = '尚未选择评论。';
    return;
  }

  selectedInfo.innerHTML = `
    <strong>${node.user}</strong>
    <p>${node.message || '（无内容）'}</p>
    <small>点赞：${node.like}</small>
  `;
}

function updateStats(page) {
  const total = state.replies.size;
  const pageInfo = page?.num ? ` · 已解析第 ${page.num} 页` : '';
  statsElement.textContent = `已捕获 ${total} 条评论${pageInfo}`;
}

diagnoseButton.addEventListener('click', async () => {
  if (!state.selectedId) {
    alert('请先选择一个评论节点。');
    return;
  }

  const selectedNode = findNode(state.selectedId);
  if (!selectedNode) {
    alert('未找到选中的评论节点。');
    return;
  }

  const lines = [];
  collectBranchLines(selectedNode, lines);
  const text = lines.join('\n');

  await analyzeWithAI(text);
});

function findNode(id) {
  const stack = [...state.roots, ...state.isolated];
  while (stack.length) {
    const node = stack.pop();
    if (node.id === id) {
      return node;
    }
    stack.push(...node.children);
  }
  return null;
}

function collectBranchLines(node, lines) {
  lines.push(`[${node.user}]: ${node.message || '（无内容）'}`);
  node.children.forEach((child) => collectBranchLines(child, lines));
}

async function analyzeWithAI(text) {
  console.log('AI analysis placeholder:', text);
}
