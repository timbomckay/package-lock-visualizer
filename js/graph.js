import { sankey as createSankey, sankeyLeft } from "d3-sankey";

export function computeMaxDepth(nodes, links) {
  if (!nodes.length || !links.length) return 1;
  const layout = createSankey()
    .nodeId((d) => d.id)
    .nodeAlign(sankeyLeft);
  const graph = layout({
    nodes: nodes.map((d) => ({ ...d })),
    links: links.map((d) => ({ ...d })),
  });
  return Math.max(0, ...graph.nodes.map((n) => n.depth ?? 0)) + 1;
}

export function filterByDepth(nodes, links, depthLimit) {
  const layout = createSankey()
    .nodeId((d) => d.id)
    .nodeAlign(sankeyLeft);
  const graph = layout({
    nodes: nodes.map((d) => ({ ...d })),
    links: links.map((d) => ({ ...d })),
  });
  const allowed = new Set(
    graph.nodes.filter((n) => (n.depth ?? 0) <= depthLimit - 1).map((n) => n.id),
  );
  return {
    nodes: nodes.filter((n) => allowed.has(n.id)),
    links: links.filter((l) => allowed.has(l.source) && allowed.has(l.target)),
  };
}

export function bfsReach(seeds, adj) {
  const visited = new Set(seeds);
  const queue = [...seeds];
  let i = 0;
  while (i < queue.length) {
    for (const nb of adj.get(queue[i++]) ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited;
}

export function buildAncestorAllowed(nodes, links, predicate) {
  const seeds = new Set(nodes.filter(predicate).map((n) => n.id));
  const incoming = new Map();
  for (const n of nodes) incoming.set(n.id, []);
  for (const l of links) incoming.get(l.target)?.push(l.source);
  return bfsReach(seeds, incoming);
}

export function computeTreeSizesFromLinks(nodes, links) {
  const outgoing = new Map();
  for (const n of nodes) outgoing.set(n.id, []);
  for (const l of links) outgoing.get(l.source)?.push(l.target);
  const sizes = new Map();
  for (const node of nodes) sizes.set(node.id, bfsReach(new Set([node.id]), outgoing).size - 1);
  return sizes;
}

export function computeTopPackages(nodes, treeSizeMap, topN = 5) {
  const byName = new Map();
  for (const n of nodes) {
    const size = treeSizeMap.get(n.id) ?? 0;
    if (!byName.has(n.name) || size > byName.get(n.name).treeSize)
      byName.set(n.name, { name: n.name, treeSize: size });
  }
  return [...byName.values()]
    .filter((p) => p.treeSize > 0)
    .sort((a, b) => b.treeSize - a.treeSize)
    .slice(0, topN);
}
