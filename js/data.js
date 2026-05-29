// Minimal semver maxSatisfying — handles the range types found in package-lock.json
// (caret, tilde, comparators, OR, AND). Replaces the semver CDN dependency.
function _parseSemver(v) {
  const m = String(v).match(/^v?(\d+)(?:\.(\d+)(?:\.(\d+))?)?(?:[+\-].*)?$/);
  return m ? [+m[1], +(m[2] ?? 0), +(m[3] ?? 0)] : null;
}
function _cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function _satisfies(v, range) {
  if (range.includes("||")) return range.split("||").some((r) => _satisfies(v, r.trim()));
  const pv = _parseSemver(v);
  if (!pv) return false;
  const r = range.trim();
  if (!r || r === "*") return true;
  const parts = r.split(/\s+/);
  if (parts.length > 1) return parts.every((p) => _satisfies(v, p));
  if (r.startsWith("^")) {
    const b = _parseSemver(r.slice(1));
    if (!b) return false;
    if (_cmp(pv, b) < 0) return false;
    if (b[0] > 0) return pv[0] === b[0];
    if (b[1] > 0) return pv[0] === 0 && pv[1] === b[1];
    return pv[0] === 0 && pv[1] === 0 && pv[2] === b[2];
  }
  if (r.startsWith("~")) {
    const b = _parseSemver(r.slice(1));
    return b ? _cmp(pv, b) >= 0 && pv[0] === b[0] && pv[1] === b[1] : false;
  }
  if (r.startsWith(">=")) {
    const b = _parseSemver(r.slice(2));
    return b ? _cmp(pv, b) >= 0 : false;
  }
  if (r.startsWith("<=")) {
    const b = _parseSemver(r.slice(2));
    return b ? _cmp(pv, b) <= 0 : false;
  }
  if (r.startsWith(">")) {
    const b = _parseSemver(r.slice(1));
    return b ? _cmp(pv, b) > 0 : false;
  }
  if (r.startsWith("<")) {
    const b = _parseSemver(r.slice(1));
    return b ? _cmp(pv, b) < 0 : false;
  }
  if (r.startsWith("=")) {
    const b = _parseSemver(r.slice(1));
    return b ? _cmp(pv, b) === 0 : false;
  }
  const b = _parseSemver(r);
  return b ? _cmp(pv, b) === 0 : v === r;
}
function maxSatisfying(versions, range) {
  let max = null,
    maxP = null;
  for (const v of versions) {
    if (!_satisfies(v, range)) continue;
    const p = _parseSemver(v);
    if (p && (!maxP || _cmp(p, maxP) > 0)) {
      max = v;
      maxP = p;
    }
  }
  return max;
}
import { parseResolvedUrl } from "./registry.js";

export function buildSankeyData(lock, { includeDev = true } = {}) {
  const packages = lock.packages ?? {};
  const rootName = lock.name || "root";

  const nodeMap = new Map();
  const pkgMap = new Map();
  const pathToId = new Map();
  const linkMap = new Map();

  for (const [path, info] of Object.entries(packages)) {
    const isRoot = path === "";
    if (!isRoot && !includeDev && info.dev) continue;

    const name = isRoot ? rootName : path.split("node_modules/").at(-1);
    const version = info.version ?? "0.0.0";
    const id = `${name}@${version}`;

    pathToId.set(path, id);
    if (!pkgMap.has(name)) pkgMap.set(name, new Map());
    pkgMap.get(name).set(version, id);

    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        name,
        nameLower: name.toLowerCase(),
        version,
        dev: info.dev ?? false,
        isPeer: info.peer ?? false,
        isOptional: info.optional ?? false,
        isRoot,
        isConflict: false,
        registry: parseResolvedUrl(info.resolved)?.hostname ?? null,
        resolved: info.resolved ?? null,
      });
    } else {
      const node = nodeMap.get(id);
      if (!info.dev) node.dev = false;
      if (!info.peer) node.isPeer = false;
      if (!info.optional) node.isOptional = false;
    }
  }

  for (const [, versions] of pkgMap) {
    if (versions.size > 1) {
      const versionList = [...versions.keys()].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
      for (const id of versions.values()) {
        const node = nodeMap.get(id);
        node.isConflict = true;
        node.conflictVersions = versionList;
      }
    }
  }

  const optionalGroupMap = new Map();

  for (const [path, info] of Object.entries(packages)) {
    const id = pathToId.get(path);
    if (!id) continue;
    const parentNode = nodeMap.get(id);
    if (
      !info.dependencies &&
      !info.devDependencies &&
      !info.optionalDependencies &&
      !info.peerDependencies
    )
      continue;

    const reqDeps = {
      ...info.dependencies,
      ...(includeDev ? info.devDependencies : undefined),
    };

    for (const [dep, range] of Object.entries(reqDeps)) {
      if (!pkgMap.has(dep)) continue;
      const versions = [...pkgMap.get(dep).keys()];
      const resolved = maxSatisfying(versions, range);
      if (!resolved) continue;
      const target = `${dep}@${resolved}`;
      const key = `${id}→${target}`;
      if (!linkMap.has(key)) linkMap.set(key, { source: id, target, value: 1 });
    }

    const alternatives = [];
    for (const [dep, range] of Object.entries(info.optionalDependencies ?? {})) {
      if (!pkgMap.has(dep)) continue;
      const versions = [...pkgMap.get(dep).keys()];
      const resolved = maxSatisfying(versions, range);
      if (!resolved) continue;
      const targetId = `${dep}@${resolved}`;
      const targetNode = nodeMap.get(targetId);
      if (!targetNode) continue;
      if (targetNode.isOptional) {
        alternatives.push({
          id: targetId,
          name: dep,
          version: resolved,
          registry: targetNode.registry,
          resolved: targetNode.resolved,
        });
      } else {
        const key = `${id}→${targetId}`;
        if (!linkMap.has(key)) linkMap.set(key, { source: id, target: targetId, value: 1 });
      }
    }

    if (alternatives.length) {
      alternatives.sort((a, b) => a.name.localeCompare(b.name));
      const groupId = `${id}\0optional`;
      const groupName = `${alternatives.length} optional`;
      optionalGroupMap.set(groupId, {
        id: groupId,
        name: groupName,
        nameLower: groupName.toLowerCase(),
        version: "",
        dev: parentNode.dev,
        isPeer: false,
        isOptional: true,
        isOptionalGroup: true,
        isRoot: false,
        isConflict: false,
        parentId: id,
        parentName: parentNode.name,
        alternatives,
      });
      const key = `${id}→${groupId}`;
      if (!linkMap.has(key))
        linkMap.set(key, { source: id, target: groupId, value: 1, isOptional: true });
    }

    for (const [dep, range] of Object.entries(info.peerDependencies ?? {})) {
      if (!pkgMap.has(dep)) continue;
      const versions = [...pkgMap.get(dep).keys()];
      const resolved = maxSatisfying(versions, range);
      if (!resolved) continue;
      const target = `${dep}@${resolved}`;
      const key = `${id}→${target}`;
      if (!nodeMap.get(target).isPeer) continue;
      if (!linkMap.has(key)) linkMap.set(key, { source: id, target, value: 1, isPeer: true });
    }
  }

  // Visible graph excludes optional-flagged real nodes; their group representative stands in.
  const visibleNodeIds = new Set();
  for (const n of nodeMap.values()) if (!n.isOptional) visibleNodeIds.add(n.id);
  for (const id of optionalGroupMap.keys()) visibleNodeIds.add(id);

  for (const [key, link] of linkMap) {
    if (!visibleNodeIds.has(link.source) || !visibleNodeIds.has(link.target)) {
      linkMap.delete(key);
    }
  }

  // Cycle break on visible graph.
  const adjacency = new Map();
  for (const id of visibleNodeIds) adjacency.set(id, new Set());
  for (const { source, target } of linkMap.values()) adjacency.get(source)?.add(target);

  const visited = new Set();
  const inPath = new Set();
  for (const startId of visibleNodeIds) {
    if (visited.has(startId)) continue;
    const stack = [{ nodeId: startId, neighbors: adjacency.get(startId).values() }];
    inPath.add(startId);
    visited.add(startId);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const { value: neighbor, done } = frame.neighbors.next();
      if (done) {
        inPath.delete(frame.nodeId);
        stack.pop();
      } else if (inPath.has(neighbor)) {
        linkMap.delete(`${frame.nodeId}→${neighbor}`);
      } else if (!visited.has(neighbor)) {
        visited.add(neighbor);
        inPath.add(neighbor);
        stack.push({ nodeId: neighbor, neighbors: adjacency.get(neighbor).values() });
      }
    }
  }

  const rootEntry = packages[""] ?? {};
  const rootDeps = new Map();
  for (const name of Object.keys(rootEntry.dependencies ?? {})) rootDeps.set(name, "prod");
  for (const name of Object.keys(rootEntry.devDependencies ?? {})) rootDeps.set(name, "dev");
  for (const name of Object.keys(rootEntry.optionalDependencies ?? {}))
    rootDeps.set(name, "optional");
  for (const name of Object.keys(rootEntry.peerDependencies ?? {})) rootDeps.set(name, "peer");

  const visibleNodes = [];
  for (const n of nodeMap.values()) if (!n.isOptional) visibleNodes.push(n);
  for (const g of optionalGroupMap.values()) visibleNodes.push(g);

  const auditNodes = Array.from(nodeMap.values());

  let installPaths = 0;
  let optionalCount = 0;
  for (const [path, info] of Object.entries(packages)) {
    if (path === "") continue;
    if (info.optional) optionalCount++;
    else installPaths++;
  }

  return {
    name: rootName,
    lockfileVersion: lock.lockfileVersion ?? 1,
    installPaths,
    optionalCount,
    uniqueCount: pkgMap.size - 1,
    packages: pkgMap,
    rootDeps,
    nodes: visibleNodes,
    auditNodes,
    links: Array.from(linkMap.values()),
  };
}
