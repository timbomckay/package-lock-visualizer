import { maxSatisfying } from "semver";

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
        isRoot,
        isConflict: false,
      });
    } else {
      const node = nodeMap.get(id);
      if (!info.dev) node.dev = false;
      if (!info.peer) node.isPeer = false;
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

  for (const [path, info] of Object.entries(packages)) {
    const id = pathToId.get(path);
    if (!id) continue;
    if (
      !info.dependencies &&
      !info.devDependencies &&
      !info.optionalDependencies &&
      !info.peerDependencies
    )
      continue;
    const allDeps = {
      ...info.dependencies,
      ...(includeDev ? info.devDependencies : undefined),
      ...info.optionalDependencies,
    };

    for (const [dep, range] of Object.entries(allDeps)) {
      if (!pkgMap.has(dep)) continue;
      const versions = [...pkgMap.get(dep).keys()];
      const resolved = maxSatisfying(versions, range);
      if (!resolved) continue;
      const target = `${dep}@${resolved}`;
      const key = `${id}→${target}`;
      if (!linkMap.has(key)) linkMap.set(key, { source: id, target, value: 1 });
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

  // Build adjacency list then run iterative DFS to drop back edges (cycle-breaking).
  const adjacency = new Map();
  for (const id of nodeMap.keys()) adjacency.set(id, new Set());
  for (const { source, target } of linkMap.values()) adjacency.get(source)?.add(target);

  const visited = new Set();
  const inPath = new Set();
  for (const startId of nodeMap.keys()) {
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

  const nodeList = Array.from(nodeMap.values());
  return {
    name: rootName,
    lockfileVersion: lock.lockfileVersion ?? 1,
    installPaths: Object.keys(packages).filter((k) => k !== "").length,
    uniqueCount: pkgMap.size - 1,
    packages: pkgMap,
    rootDeps,
    nodes: nodeList,
    links: Array.from(linkMap.values()),
  };
}
