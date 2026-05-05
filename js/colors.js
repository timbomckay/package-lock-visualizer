import { DEPTH_COLORS, SEVERITY_RANK, SEVERITY_COLOR } from "./constants.js";

export function parseCvssV3Score(vector) {
  const m = {};
  for (const part of vector.split("/").slice(1)) {
    const [k, v] = part.split(":");
    m[k] = v;
  }
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV] ?? 0.85;
  const AC = { L: 0.77, H: 0.44 }[m.AC] ?? 0.77;
  const sc = m.S === "C";
  const PR = sc
    ? ({ N: 0.85, L: 0.68, H: 0.5 }[m.PR] ?? 0.85)
    : ({ N: 0.85, L: 0.62, H: 0.27 }[m.PR] ?? 0.85);
  const UI = { N: 0.85, R: 0.62 }[m.UI] ?? 0.85;
  const CIA = { N: 0, L: 0.22, H: 0.56 };
  const iscBase = 1 - (1 - (CIA[m.C] ?? 0)) * (1 - (CIA[m.I] ?? 0)) * (1 - (CIA[m.A] ?? 0));
  const isc = sc ? 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15) : 6.42 * iscBase;
  if (isc <= 0) return 0;
  const base = sc
    ? Math.min(1.08 * (isc + 8.22 * AV * AC * PR * UI), 10)
    : Math.min(isc + 8.22 * AV * AC * PR * UI, 10);
  return Math.ceil(base * 10) / 10;
}

export function getSeverity(v) {
  const db = v.database_specific?.severity?.toUpperCase();
  if (db && SEVERITY_RANK[db]) return db;
  for (const s of v.severity ?? []) {
    if (s.type === "CVSS_V3") {
      try {
        const score = parseCvssV3Score(s.score);
        if (score >= 9.0) return "CRITICAL";
        if (score >= 7.0) return "HIGH";
        if (score >= 4.0) return "MODERATE";
        if (score > 0) return "LOW";
      } catch {}
    }
  }
  return null;
}

export function worstSeverity(vulns) {
  let worst = null,
    rank = 0;
  for (const v of vulns) {
    const s = getSeverity(v);
    if (s && (SEVERITY_RANK[s] ?? 0) > rank) {
      worst = s;
      rank = SEVERITY_RANK[s];
    }
  }
  return worst;
}

export function vulnColor(vulns) {
  const s = worstSeverity(vulns);
  return SEVERITY_COLOR[s] ?? "#ef4444";
}

export const depthColor = (d) =>
  d.isConflict ? "#c026d3" : DEPTH_COLORS[Math.min(d.depth ?? 0, DEPTH_COLORS.length - 1)];
