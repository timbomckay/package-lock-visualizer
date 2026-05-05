import * as d3 from "d3";
import { sankey as createSankey, sankeyLinkHorizontal, sankeyLeft } from "d3-sankey";
import { NO_PACKAGES_MSG, SEVERITY_COLOR } from "./constants.js";
import { depthColor, worstSeverity, vulnColor, getSeverity } from "./colors.js";
import { showTip, hideTip } from "./tooltip.js";
import { filterByDepth } from "./graph.js";

export function renderSankey(
  container,
  nodes,
  links,
  depthLimit,
  treeSizeMap,
  onNodeClick,
  vulnMap,
) {
  container.innerHTML = "";

  const visible = depthLimit != null ? filterByDepth(nodes, links, depthLimit) : { nodes, links };
  nodes = visible.nodes;
  links = visible.links;

  if (!nodes.length) {
    container.innerHTML = NO_PACKAGES_MSG;
    return;
  }

  if (!links.length) {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;flex-wrap:wrap;gap:8px;padding:24px;align-content:flex-start;";
    for (const n of nodes) {
      const tag = document.createElement("span");
      const color = vulnMap?.has(n.id)
        ? vulnColor(vulnMap.get(n.id))
        : n.isConflict
          ? "#c026d3"
          : "#6366f1";
      tag.style.cssText = `display:inline-block;padding:4px 10px;border-radius:4px;font-size:12px;font-family:system-ui,sans-serif;border:1px solid ${color}44;color:#cbd5e1;background:${color}18;`;
      tag.textContent = `${n.name}@${n.version}`;
      wrap.appendChild(tag);
    }
    container.appendChild(wrap);
    return;
  }

  const W = Math.max(container.clientWidth || 900, 600);
  const H = Math.max(640, nodes.length * 22 + 60);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", W)
    .attr("height", H)
    .style("font-family", "system-ui, sans-serif");

  const layout = createSankey()
    .nodeId((d) => d.id)
    .nodeWidth(14)
    .nodePadding(6)
    .nodeAlign(sankeyLeft)
    .extent([
      [12, 12],
      [W - 12, H - 12],
    ]);

  const graph = layout({
    nodes: nodes.map((d) => ({ ...d })),
    links: links.map((d) => ({ ...d })),
  });

  const defs = svg.append("defs");
  ["LOW", "MODERATE", "HIGH", "CRITICAL"].forEach((sev) => {
    const color = SEVERITY_COLOR[sev];
    const pat = defs
      .append("pattern")
      .attr("id", `vp-${sev}`)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", 8)
      .attr("height", 8)
      .attr("patternTransform", "rotate(45 0 0)");
    pat.append("rect").attr("width", 8).attr("height", 8).attr("fill", color);
    pat.append("rect").attr("width", 2).attr("height", 8).attr("fill", "#000").attr("opacity", 0.5);
  });

  svg
    .append("g")
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("class", (d) => `sankey-link${d.isPeer ? " peer" : ""}`)
    .attr("d", sankeyLinkHorizontal())
    .attr("stroke", (d) => (d.target.isConflict ? "#c026d3" : depthColor(d.source)))
    .attr("stroke-width", (d) => Math.max(1, d.width))
    .on("mousemove", (ev, d) =>
      showTip(
        ev,
        `<span style="color:#94a3b8">${d.source.name}</span> <span style="color:#475569">→</span> <span style="color:#94a3b8">${d.target.name}</span>${d.isPeer ? ' <span style="color:#7c3aed;font-size:10px">(peer)</span>' : ""}`,
      ),
    )
    .on("mouseleave", hideTip);

  const nodeG = svg
    .append("g")
    .selectAll("g")
    .data(graph.nodes)
    .join("g")
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  nodeG
    .append("rect")
    .attr("height", (d) => Math.max(3, d.y1 - d.y0))
    .attr("width", (d) => d.x1 - d.x0)
    .attr("rx", 2)
    .attr("fill", (d) => {
      const vulns = vulnMap?.get(d.id);
      if (!vulns) return depthColor(d);
      const sev = worstSeverity(vulns) ?? "CRITICAL";
      return `url(#vp-${sev})`;
    });

  nodeG
    .append("text")
    .attr("x", (d) => (d.x0 < W / 2 ? d.x1 - d.x0 + 6 : -6))
    .attr("y", (d) => (d.y1 - d.y0) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => (d.x0 < W / 2 ? "start" : "end"))
    .attr("fill", "#cbd5e1")
    .attr("font-size", 11)
    .text((d) => {
      const l = d.isRoot ? `${d.name} (root)` : d.name;
      return l.length > 32 ? l.slice(0, 30) + "…" : l;
    });

  nodeG
    .style("cursor", (d) => (d.isRoot || !onNodeClick ? "default" : "pointer"))
    .on("mousemove", (ev, d) => {
      const into = d.targetLinks?.length ?? 0;
      const treeSize = treeSizeMap.get(d.id) ?? 0;
      const typeLabel = d.isPeer
        ? '<span style="color:#7c3aed">peer</span>'
        : d.dev
          ? '<span style="color:#64748b">dev</span>'
          : '<span style="color:#10b981">prod</span>';
      const versionLine =
        d.isConflict && d.conflictVersions?.length
          ? `<div style="color:#c026d3;font-size:11px">${d.conflictVersions.length} versions: ${d.conflictVersions.join(", ")}</div>`
          : `<div style="color:#64748b;font-size:11px">v${d.version}</div>`;
      const nodeVulns = vulnMap?.get(d.id) ?? [];
      const vulnHtml = nodeVulns.length
        ? (() => {
            const color = vulnColor(nodeVulns);
            return `<div style="color:${color};margin-top:6px;padding-top:6px;border-top:1px solid #334155;font-weight:600">⚠ ${nodeVulns.length} vulnerability${nodeVulns.length !== 1 ? "ies" : ""}</div>
              ${nodeVulns
                .slice(0, 3)
                .map((v) => {
                  const sev = getSeverity(v);
                  const sevColor = sev ? (SEVERITY_COLOR[sev] ?? "#fca5a5") : "#fca5a5";
                  return `<div style="font-size:10px;margin-top:2px"><a href="https://osv.dev/vulnerability/${v.id}" target="_blank" rel="noopener" style="color:#94a3b8;text-decoration:underline;text-decoration-color:#475569;text-underline-offset:2px">${v.id}</a>${sev ? ` · <span style="color:${sevColor};font-weight:600">${sev}</span>` : ""}</div>`;
                })
                .join("")}
              ${nodeVulns.length > 3 ? `<div style="font-size:10px;color:#64748b">+${nodeVulns.length - 3} more</div>` : ""}`;
          })()
        : "";
      showTip(
        ev,
        `<div style="font-weight:600;color:#f1f5f9">${d.name}${d.isRoot ? ' <span style="color:#818cf8">(root)</span>' : ""}</div>
              ${versionLine}
              <div style="color:#64748b;margin-top:4px">Depth <span style="color:#94a3b8">${d.depth ?? 0}</span></div>
              <div style="color:#64748b">Used by <span style="color:#94a3b8">${into}</span> pkg${into !== 1 ? "s" : ""}</div>
              <div style="color:#64748b">Tree size <span style="color:#94a3b8">${treeSize}</span> pkg${treeSize !== 1 ? "s" : ""}</div>
              ${!d.isRoot ? `<div style="color:#64748b">${typeLabel}</div>` : ""}
              ${vulnHtml}
              ${!d.isRoot ? '<div style="color:#475569;font-size:11px;margin-top:4px">Click to isolate</div>' : ""}`,
      );
    })
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => {
      if (d.isRoot || !onNodeClick) return;
      hideTip();
      onNodeClick(d.name);
    });
}
