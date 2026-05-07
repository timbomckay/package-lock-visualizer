import { NO_PACKAGES_MSG, SEVERITY_COLOR } from "./constants.js";
import { worstSeverity } from "./colors.js";
import { getRegistryLink } from "./registry.js";

const GROUP_CONFIG = [
  { key: "prod", label: "Production", color: "#10b981" },
  { key: "dev", label: "Development", color: "#6366f1" },
  { key: "peer", label: "Peer", color: "#a78bfa" },
  { key: "optional", label: "Optional", color: "#f59e0b" },
];

export function renderList(container, nodes, treeSizeMap, rootDeps, vulnMap, onPackageClick) {
  container.innerHTML = "";
  container.style.minHeight = "";

  if (!nodes.length) {
    container.innerHTML = NO_PACKAGES_MSG;
    return;
  }

  const groups = { prod: [], dev: [], peer: [], optional: [] };
  for (const node of nodes) {
    const type = node.isOptionalGroup
      ? "optional"
      : (rootDeps.get(node.name) ?? (node.dev ? "dev" : "prod"));
    groups[type].push({ ...node, treeSize: treeSizeMap.get(node.id) ?? 0 });
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => b.treeSize - a.treeSize || a.name.localeCompare(b.name));
  }

  const maxSize = Math.max(1, ...nodes.map((n) => treeSizeMap.get(n.id) ?? 0));

  const wrap = document.createElement("div");
  wrap.style.cssText = "padding:8px 0;font-family:system-ui,sans-serif";

  for (const { key, label, color } of GROUP_CONFIG) {
    const list = groups[key];
    if (!list.length) continue;

    const section = document.createElement("div");
    section.style.cssText = "margin-bottom:24px";

    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
    hdr.innerHTML = `
      <span style="color:${color};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em">${label}</span>
      <span style="color:#334155;font-size:11px">${list.length}</span>
      <div style="flex:1;height:1px;background:#1e293b"></div>
    `;
    section.appendChild(hdr);

    for (const pkg of list) {
      const row = document.createElement("div");
      row.style.cssText = `
        display:grid;grid-template-columns:1fr 100px 68px 18px;
        align-items:center;gap:10px;
        padding:7px 10px;margin-bottom:3px;
        border-radius:7px;cursor:pointer;
        border:1px solid transparent;background:transparent;
        transition:background .1s,border-color .1s;
      `;

      const pkgVulns = vulnMap?.get(pkg.id) ?? [];
      const pkgWorstSev = pkgVulns.length ? worstSeverity(pkgVulns) : null;
      const pkgVulnColor = pkgWorstSev ? SEVERITY_COLOR[pkgWorstSev] : null;

      const nameDiv = document.createElement("div");
      if (pkg.isOptionalGroup) {
        nameDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;min-width:0">
          <div style="font-size:13px;color:#cbd5e1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pkg.parentName}</div>
          <span style="flex-shrink:0;font-size:10px;color:#f59e0b;background:#1f1808;border:1px solid #f59e0b44;border-radius:3px;padding:1px 5px;white-space:nowrap">${pkg.alternatives.length} optional</span>
        </div>
        <div style="font-size:11px;color:#475569;margin-top:1px">1 of ${pkg.alternatives.length} installs per OS/CPU</div>
      `;
      } else {
        nameDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;min-width:0">
          <div style="font-size:13px;color:${pkgVulnColor ?? (pkg.isConflict ? "#c026d3" : "#cbd5e1")};font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pkg.name}</div>
          ${pkgVulns.length ? `<span style="flex-shrink:0;font-size:10px;color:${pkgVulnColor};background:#1f1010;border:1px solid ${pkgVulnColor}44;border-radius:3px;padding:1px 5px;white-space:nowrap">⚠ ${pkgWorstSev ?? "VULN"}</span>` : ""}
        </div>
        <div style="font-size:11px;color:#475569;margin-top:1px">v${pkg.version}${pkg.isConflict && pkg.conflictVersions?.length ? ` · <span style="color:#a21caf">${pkg.conflictVersions.length} versions</span>` : ""}</div>
      `;
      }

      const barPct = Math.max(2, (pkg.treeSize / maxSize) * 100);
      const barTrack = document.createElement("div");
      barTrack.style.cssText = "height:4px;background:#1e293b;border-radius:2px;overflow:hidden";
      barTrack.innerHTML = `<div style="width:${barPct.toFixed(1)}%;height:4px;background:${color};border-radius:2px;min-width:2px"></div>`;

      const countDiv = document.createElement("div");
      countDiv.style.cssText = "font-size:12px;color:#475569;text-align:right;white-space:nowrap";
      countDiv.textContent =
        pkg.treeSize === 0 ? "no deps" : `${pkg.treeSize} dep${pkg.treeSize !== 1 ? "s" : ""}`;

      const linkSlot = document.createElement("div");
      linkSlot.style.cssText = "display:flex;justify-content:flex-end";
      const link = getRegistryLink(pkg);
      if (link) {
        const a = document.createElement("a");
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = `View on ${link.label}`;
        a.style.cssText =
          "color:#475569;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:3px;transition:color .1s,background .1s";
        a.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
        a.addEventListener("click", (e) => e.stopPropagation());
        a.addEventListener("mouseenter", () => {
          a.style.color = "#cbd5e1";
        });
        a.addEventListener("mouseleave", () => {
          a.style.color = "#475569";
        });
        linkSlot.appendChild(a);
      }

      row.appendChild(nameDiv);
      row.appendChild(barTrack);
      row.appendChild(countDiv);
      row.appendChild(linkSlot);

      row.addEventListener("mouseenter", () => {
        row.style.background = "#1e293b";
        row.style.borderColor = "#334155";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
        row.style.borderColor = "transparent";
      });
      row.addEventListener("click", () => onPackageClick(pkg));

      section.appendChild(row);
    }

    wrap.appendChild(section);
  }

  container.appendChild(wrap);
}
