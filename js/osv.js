const CHUNK = 1000;
const CONCURRENCY = 10;
const isSemverLike = (v) => /^v?\d+\.\d/.test(v);

export async function queryOSV(nodes, signal) {
  const nodeList = nodes.filter((n) => !n.isRoot && isSemverLike(n.version));
  const vulnMap = new Map();

  // Phase 1: batch query → get compact stub objects (id + modified only)
  for (let i = 0; i < nodeList.length; i += CHUNK) {
    const chunk = nodeList.slice(i, i + CHUNK);
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: chunk.map((n) => ({
          version: n.version,
          package: { name: n.name, ecosystem: "npm" },
        })),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`OSV ${res.status}`);
    const { results } = await res.json();
    for (let j = 0; j < chunk.length; j++) {
      const vulns = results[j]?.vulns ?? [];
      if (vulns.length) vulnMap.set(chunk[j].id, vulns);
    }
  }

  // Phase 2: fetch full vuln details (severity, CVSS, etc.) for each unique ID
  const uniqueIds = [...new Set([...vulnMap.values()].flat().map((v) => v.id))];
  const fullById = new Map();
  for (let i = 0; i < uniqueIds.length; i += CONCURRENCY) {
    const batch = uniqueIds.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map((id) =>
        fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    );
    for (const v of fetched) if (v) fullById.set(v.id, v);
  }

  // Replace stubs with full objects
  for (const [nodeId, vulns] of vulnMap) {
    vulnMap.set(
      nodeId,
      vulns.map((v) => fullById.get(v.id) ?? v),
    );
  }

  return vulnMap;
}
