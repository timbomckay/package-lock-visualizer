import { LitElement, html } from "lit";
import { STORAGE_KEY, DEPTH_COLORS } from "./constants.js";
import { buildSankeyData } from "./data.js";
import { hideTip } from "./tooltip.js";
import {
  computeMaxDepth,
  buildAncestorAllowed,
  bfsReach,
  computeTreeSizesFromLinks,
  computeTopPackages,
} from "./graph.js";
import { renderSankey } from "./sankey.js";
import { renderList } from "./list.js";
import { queryOSV } from "./osv.js";
import { getRegistryLink } from "./registry.js";

export class PkgLockVisualizer extends LitElement {
  static properties = {
    _phase: { state: true },
    _data: { state: true },
    _error: { state: true },
    _maxDepth: { state: true },
    _selectedDepth: { state: true },
    _filter: { state: true },
    _conflictCount: { state: true },
    _searchQuery: { state: true },
    _visibleCount: { state: true },
    _suggestions: { state: true },
    _inputFocused: { state: true },
    _focusedPackage: { state: true },
    _topPackages: { state: true },
    _showInfo: { state: true },
    _optionalGroup: { state: true },
    _savedFiles: { state: true },
    _vulnMap: { state: true },
    _vulnStatus: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._phase = "idle";
    this._data = null;
    this._error = "";
    this._maxDepth = null;
    this._selectedDepth = null;
    this._filter = "all";
    this._conflictCount = 0;
    this._searchQuery = "";
    this._visibleCount = 0;
    this._suggestions = [];
    this._inputFocused = false;
    this._focusedPackage = null;
    this._topPackages = null;
    this._showInfo = false;
    this._optionalGroup = null;
    this._savedFiles = [];
    this._vulnMap = null;
    this._vulnStatus = "idle";
    this._osvController = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadSavedFiles();
  }

  _onDragOver(e) {
    e.preventDefault();
    this.querySelector(".drop-zone")?.classList.add("drag-over");
  }
  _onDragLeave() {
    this.querySelector(".drop-zone")?.classList.remove("drag-over");
  }
  _onDrop(e) {
    e.preventDefault();
    this.querySelector(".drop-zone")?.classList.remove("drag-over");
    this._loadFile(e.dataTransfer?.files?.[0]);
  }
  _onFileInput(e) {
    this._loadFile(e.target.files?.[0]);
  }

  _loadJson(json) {
    try {
      if (!json.dependencies && !json.packages) {
        throw new Error("Missing dependencies/packages field — is this a package-lock.json?");
      }
      const data = buildSankeyData(json);
      const rootId = data.nodes.find((n) => n.isRoot)?.id;
      const depthNodes = data.nodes.filter((n) => !n.isRoot);
      const depthLinks = data.links.filter((l) => l.source !== rootId);
      const maxDepth = computeMaxDepth(depthNodes, depthLinks);
      this._data = data;
      this._maxDepth = maxDepth;
      this._selectedDepth = maxDepth;
      this._conflictCount = data.nodes.filter((n) => n.isConflict).length;
      this._filter = "all";
      this._searchQuery = "";
      this._visibleCount = 0;
      this._focusedPackage = null;
      this._vulnMap = null;
      this._vulnStatus = "loading";
      this._phase = "loaded";
      this._error = "";
      document.title = `Package Lock Visualizer — ${data.name}`;
      this.requestUpdate();
      this._redraw();
      this._osvController?.abort();
      this._osvController = new AbortController();
      this._runOSV(data.auditNodes ?? data.nodes, this._osvController.signal);
    } catch (err) {
      console.error(err);
      this._error = err.message;
      this._phase = "error";
    }
  }

  _loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = e.target.result;
        this._loadJson(JSON.parse(raw));
        this._saveFile(file.name, raw);
      } catch (err) {
        console.error(err);
        this._error = err.message;
        this._phase = "error";
      }
    };
    reader.readAsText(file);
  }

  async _runOSV(nodes, signal) {
    try {
      this._vulnMap = await queryOSV(nodes, signal);
      this._vulnStatus = "done";
      this.requestUpdate();
      this._redraw();
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("OSV query failed:", err);
      this._vulnStatus = "error";
      this.requestUpdate();
    }
  }

  _loadSavedFiles() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      this._savedFiles = stored ? JSON.parse(stored) : [];
    } catch {
      this._savedFiles = [];
    }
  }

  _saveFile(filename, raw) {
    try {
      const { name, installPaths } = this._data;
      const entry = {
        id: crypto.randomUUID(),
        name,
        filename,
        pkgCount: installPaths,
        savedAt: new Date().toISOString(),
        raw,
      };
      const updated = [entry, ...this._savedFiles.filter((f) => f.name !== name)].slice(0, 10);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      this._savedFiles = updated;
    } catch {
      // storage quota exceeded or unavailable
    }
  }

  _deleteFile(id, e) {
    e.stopPropagation();
    const updated = this._savedFiles.filter((f) => f.id !== id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // storage quota exceeded or unavailable
    }
    this._savedFiles = updated;
  }

  _getFilteredData() {
    const rootId = this._data.nodes.find((n) => n.isRoot)?.id;
    let nodes = this._data.nodes.filter((n) => !n.isRoot);
    let links = this._data.links.filter((l) => l.source !== rootId);

    if (this._filter !== "all") {
      let allowed;
      if (this._filter === "prod") allowed = new Set(nodes.filter((n) => !n.dev).map((n) => n.id));
      else if (this._filter === "dev")
        allowed = new Set(nodes.filter((n) => n.dev).map((n) => n.id));
      else if (this._filter === "conflict")
        allowed = buildAncestorAllowed(nodes, links, (n) => n.isConflict);
      else if (this._filter === "vuln")
        allowed = buildAncestorAllowed(nodes, links, (n) => this._vulnMap?.has(n.id));
      nodes = nodes.filter((n) => allowed.has(n.id));
      links = links.filter((l) => allowed.has(l.source) && allowed.has(l.target));
    }

    if (this._focusedPackage) {
      return this._getFocusSubgraph(nodes, links);
    }

    return { nodes, links };
  }

  _redraw() {
    this.updateComplete.then(() => this._draw());
  }

  _draw() {
    const container = this.querySelector("#sankey-container");
    if (!container || !this._data) return;

    const { nodes, links } = this._getFilteredData();
    const treeSizeMap = computeTreeSizesFromLinks(nodes, links);
    const newTop = computeTopPackages(nodes, treeSizeMap);
    const topKey = newTop.map((p) => `${p.name}:${p.treeSize}`).join(",");
    const curKey = (this._topPackages ?? []).map((p) => `${p.name}:${p.treeSize}`).join(",");
    if (topKey !== curKey) this._topPackages = newTop;
    const useListView = this._selectedDepth === 1 && !this._focusedPackage;
    const onNodeClick = (node) => {
      if (node?.isOptionalGroup) {
        this._optionalGroup = node;
        return;
      }
      this._focusPackage(node?.name ?? node);
    };
    if (useListView) {
      const directNodes = nodes.filter((n) => this._data.rootDeps.has(n.name) || n.isOptionalGroup);
      renderList(
        container,
        directNodes,
        treeSizeMap,
        this._data.rootDeps,
        this._vulnMap,
        onNodeClick,
      );
      if (this._visibleCount !== directNodes.length) this._visibleCount = directNodes.length;
    } else {
      container.style.minHeight = "640px";
      renderSankey(
        container,
        nodes,
        links,
        this._selectedDepth,
        treeSizeMap,
        onNodeClick,
        this._vulnMap,
      );
      if (this._visibleCount !== nodes.length) this._visibleCount = nodes.length;
    }
  }

  _focusPackage(name) {
    if (this._focusedPackage === name) {
      this._clearSearch();
      return;
    }
    this._searchQuery = name;
    this._focusedPackage = name;
    this._selectedDepth = this._maxDepth;
    this._inputFocused = false;
    this._suggestions = [];
    this._redraw();
  }

  _onDepthChange(e) {
    this._selectedDepth = Number(e.target.value);
    this._redraw();
  }

  _setFilter(value) {
    this._filter = this._filter === value ? "all" : value;
    this._redraw();
  }

  _renderVulnStatus() {
    if (this._vulnStatus === "loading")
      return html`<span class="text-xs text-slate-500 select-none animate-pulse"
        >Running audit…</span
      >`;
    if (this._vulnStatus === "done" && this._vulnMap?.size)
      return html`<button
        @click=${() => this._setFilter("vuln")}
        class="text-xs font-semibold select-none cursor-pointer transition-opacity hover:opacity-70"
        style="color:#ef4444;background:none;border:none;padding:0"
      >
        ⚠ audit: ${this._vulnMap.size}
      </button>`;
    if (this._vulnStatus === "done")
      return html`<span class="text-xs select-none" style="color:#10b981">✓ audit clean</span>`;
    if (this._vulnStatus === "error")
      return html`<span class="text-xs text-slate-600 select-none">OSV unavailable</span>`;
    return "";
  }

  _computeSuggestions(q) {
    if (!q || !this._data) return [];
    const lower = q.toLowerCase();
    const seen = new Map();
    for (const n of this._data.nodes) {
      if (n.isRoot) continue;
      if (!n.nameLower.includes(lower)) continue;
      if (!seen.has(n.name) || (n.isConflict && !seen.get(n.name).isConflict))
        seen.set(n.name, { name: n.name, isConflict: n.isConflict });
    }
    return [...seen.values()]
      .sort((a, b) => {
        const aExact = a.name.toLowerCase() === lower;
        const bExact = b.name.toLowerCase() === lower;
        if (aExact !== bExact) return aExact ? -1 : 1;
        const aStart = a.name.toLowerCase().startsWith(lower);
        const bStart = b.name.toLowerCase().startsWith(lower);
        if (aStart !== bStart) return aStart ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 10);
  }

  _onSearchInput(e) {
    this._searchQuery = e.target.value;
    this._focusedPackage = null;
    this._suggestions = this._computeSuggestions(this._searchQuery);
  }

  _onSearchFocus() {
    this._inputFocused = true;
  }

  _onSearchBlur() {
    setTimeout(() => {
      this._inputFocused = false;
    }, 120);
  }

  _clearSearch() {
    this._searchQuery = "";
    this._focusedPackage = null;
    this._inputFocused = false;
    this._suggestions = [];
    this._redraw();
  }

  _getFocusSubgraph(nodes, links) {
    const seedIds = new Set(nodes.filter((n) => n.name === this._focusedPackage).map((n) => n.id));

    const incoming = new Map();
    const outgoing = new Map();
    for (const n of nodes) {
      incoming.set(n.id, []);
      outgoing.set(n.id, []);
    }
    for (const l of links) {
      incoming.get(l.target)?.push(l.source);
      outgoing.get(l.source)?.push(l.target);
    }

    const ancestors = bfsReach(seedIds, incoming);
    const descendants = bfsReach(seedIds, outgoing);
    const allowed = new Set([...ancestors, ...descendants]);
    return {
      nodes: nodes.filter((n) => allowed.has(n.id)),
      links: links.filter((l) => allowed.has(l.source) && allowed.has(l.target)),
    };
  }

  _setDepthFromLegend(colorIndex) {
    const depth =
      colorIndex >= DEPTH_COLORS.length - 1
        ? this._maxDepth
        : Math.min(colorIndex + 1, this._maxDepth);
    this._selectedDepth = depth;
    this._redraw();
  }

  _reset() {
    this._phase = "idle";
    this._data = null;
    this._error = "";
    this._maxDepth = null;
    this._selectedDepth = null;
    this._filter = "all";
    this._conflictCount = 0;
    this._searchQuery = "";
    this._visibleCount = 0;
    this._suggestions = [];
    this._inputFocused = false;
    this._focusedPackage = null;
    this._topPackages = null;
    this._showInfo = false;
    this._vulnMap = null;
    this._vulnStatus = "idle";
    this._osvController?.abort();
    this._osvController = null;
    document.title = "Package Lock Visualizer";
    hideTip();
  }

  render() {
    const rootNode = this._data?.nodes.find((n) => n.isRoot);
    const totalCount = this._data?.nodes.filter((n) => !n.isRoot).length ?? 0;
    return html`
      <div class="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
        <!-- Branding header -->
        <header class="px-6 pt-5 pb-4">
          <div class="max-w-screen-xl mx-auto flex items-start justify-between">
            <div>
              ${rootNode?.version
                ? html`
                    <div class="text-xs font-medium text-slate-500 uppercase tracking-widest mb-1">
                      v${rootNode.version}
                    </div>
                  `
                : ""}
              <h1 class="text-2xl font-semibold tracking-tight">
                ${this._data ? this._data.name : "Package Lock Visualizer"}
              </h1>
              ${!this._data
                ? html`
                    <p class="text-slate-400 text-sm mt-1">
                      Upload a
                      <code class="text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded text-xs"
                        >package-lock.json</code
                      >
                      to explore dependencies as a Sankey diagram
                    </p>
                  `
                : ""}
            </div>
            <span class="text-slate-600 text-sm font-medium select-none mt-1.5"
              >Package Lock Visualizer</span
            >
          </div>
        </header>

        <!-- Sticky control bar (only when data loaded) -->
        ${this._phase === "loaded"
          ? html`
              <div class="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 px-6 py-2.5">
                <div class="max-w-screen-xl mx-auto flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 flex-wrap">
                    ${this._maxDepth
                      ? html`
                          <div
                            class="flex items-center gap-2 text-sm text-slate-400
                            border border-slate-700 rounded px-3 py-1"
                          >
                            <span class="select-none">Depth</span>
                            <select
                              @change=${this._onDepthChange}
                              class="bg-transparent text-slate-200 cursor-pointer outline-none"
                            >
                              ${Array.from({ length: this._maxDepth }, (_, i) => i + 1).map(
                                (d) => html`
                                  <option
                                    value=${d}
                                    ?selected=${d === this._selectedDepth}
                                    style="background:#0f172a"
                                  >
                                    ${d}
                                  </option>
                                `,
                              )}
                            </select>
                          </div>
                          <div class="w-px h-5 bg-slate-800 select-none"></div>
                        `
                      : ""}
                    <div class="flex items-center gap-1.5">
                      ${[
                        {
                          value: "prod",
                          label: "Prod",
                          activeStyle:
                            "border-color:#cbd5e1;background:#cbd5e1;color:#0f172a;box-shadow:0 1px 0 rgba(255,255,255,0.05) inset",
                        },
                        {
                          value: "dev",
                          label: "Dev",
                          activeStyle:
                            "border-color:#cbd5e1;background:#cbd5e1;color:#0f172a;box-shadow:0 1px 0 rgba(255,255,255,0.05) inset",
                        },
                        {
                          value: "conflict",
                          label: `Conflicts${this._conflictCount ? " " + this._conflictCount : ""}`,
                          activeStyle: "border-color:#a855f7;background:#a855f7;color:#1a0a24",
                        },
                        ...(this._vulnStatus === "done"
                          ? [
                              {
                                value: "vuln",
                                label: `Audit${this._vulnMap?.size ? " " + this._vulnMap.size : ""}`,
                                activeStyle:
                                  "border-color:#f97316;background:#f97316;color:#1a0a00",
                              },
                            ]
                          : []),
                      ].map(
                        ({ value, label, activeStyle }) => html`
                          <button
                            @click=${() => this._setFilter(value)}
                            class="text-sm px-3 py-1 rounded-md border cursor-pointer select-none transition-colors font-medium"
                            style="${this._filter === value
                              ? activeStyle
                              : "border-color:#334155;color:#94a3b8;background:transparent"}"
                          >
                            ${label}
                          </button>
                        `,
                      )}
                    </div>
                    <div class="w-px h-5 bg-slate-800 select-none"></div>
                    <div style="position:relative">
                      <div
                        class="flex items-center gap-2 text-sm text-slate-400
                            border border-slate-700 rounded px-3 py-1"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="shrink-0 text-slate-500"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                          type="text"
                          placeholder="Filter package..."
                          .value=${this._searchQuery}
                          @input=${this._onSearchInput}
                          @focus=${this._onSearchFocus}
                          @blur=${this._onSearchBlur}
                          class="bg-transparent text-slate-200 outline-none placeholder-slate-600 w-40"
                        />
                        ${this._searchQuery
                          ? html`
                              <button
                                @click=${this._clearSearch}
                                class="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer leading-none"
                                style="font-size:16px;line-height:1"
                              >
                                ×
                              </button>
                            `
                          : ""}
                      </div>
                      ${this._inputFocused && this._suggestions.length
                        ? html`
                            <div
                              style="position:absolute;top:calc(100% + 4px);left:0;z-index:50;min-width:260px"
                              class="bg-slate-800 border border-slate-700 rounded-lg py-1 shadow-xl"
                            >
                              ${this._suggestions.map(
                                (s) => html`
                                  <div
                                    @mousedown=${() => this._focusPackage(s.name)}
                                    class="flex items-center justify-between px-4 py-2.5 cursor-pointer
                                     hover:bg-slate-700/60 text-sm transition-colors"
                                  >
                                    <span
                                      class="${s.isConflict
                                        ? "text-fuchsia-400"
                                        : "text-slate-200"}"
                                    >
                                      ${s.name}
                                    </span>
                                    ${s.isConflict
                                      ? html`<span class="text-xs text-fuchsia-500 select-none"
                                          >conflict</span
                                        >`
                                      : ""}
                                  </div>
                                `,
                              )}
                            </div>
                          `
                        : ""}
                    </div>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    ${this._renderVulnStatus()}
                    <div style="position:relative">
                      <span class="text-sm text-slate-500 select-none">
                        <strong class="text-slate-300 font-medium">${this._visibleCount}</strong>
                        ${this._visibleCount !== totalCount ? html`of ${totalCount} ` : ""}packages
                      </span>
                      <button
                        @click=${() => (this._showInfo = !this._showInfo)}
                        class="ml-1.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer align-middle"
                        style="font-size:14px;line-height:1"
                        title="Package stats"
                      >
                        ⓘ
                      </button>
                      ${this._showInfo
                        ? html`
                            <div
                              style="position:fixed;inset:0;z-index:99"
                              @click=${() => (this._showInfo = false)}
                            ></div>
                            <div
                              style="position:absolute;right:0;top:calc(100% + 8px);z-index:100;min-width:260px"
                              class="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-4"
                              @click=${(e) => e.stopPropagation()}
                            >
                              ${[
                                [
                                  "Visible",
                                  html`<span class="text-slate-200 font-medium"
                                    >${this._visibleCount} packages</span
                                  >`,
                                ],
                                ["Total unique", this._data.uniqueCount],
                                ["Install paths", this._data.installPaths],
                                ...(this._data.optionalCount
                                  ? [
                                      [
                                        "Optional",
                                        html`<span style="color:#f59e0b"
                                          >${this._data.optionalCount}</span
                                        >`,
                                      ],
                                    ]
                                  : []),
                                ["Max depth", this._maxDepth],
                                ["Lockfile version", `v${this._data.lockfileVersion}`],
                                [
                                  "Version conflicts",
                                  html`<span style="${this._conflictCount ? "color:#c026d3" : ""}"
                                    >${this._conflictCount}</span
                                  >`,
                                ],
                                [
                                  "Audit issues",
                                  this._vulnStatus === "loading"
                                    ? html`<span style="color:#64748b">checking…</span>`
                                    : this._vulnStatus === "done"
                                      ? html`<span
                                          style="${this._vulnMap?.size
                                            ? "color:#ef4444"
                                            : "color:#10b981"}"
                                          >${this._vulnMap?.size ?? 0}</span
                                        >`
                                      : html`<span style="color:#64748b">unavailable</span>`,
                                ],
                              ].map(
                                ([label, value]) => html`
                                  <div
                                    class="flex items-center justify-between py-1.5 text-sm border-b border-slate-700/50 last:border-0"
                                  >
                                    <span class="text-slate-400">${label}</span>
                                    <span class="text-slate-200">${value}</span>
                                  </div>
                                `,
                              )}
                            </div>
                          `
                        : ""}
                    </div>
                    <button
                      @click=${this._reset}
                      class="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200
                       border border-slate-700 hover:border-slate-500 rounded px-3 py-1
                       transition-colors cursor-pointer"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="16 16 12 12 8 16" />
                        <line x1="12" y1="12" x2="12" y2="21" />
                        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                      </svg>
                      Upload
                    </button>
                  </div>
                </div>
              </div>
            `
          : ""}

        <!-- Content -->
        <div class="flex-1 px-6 pb-6 pt-6">
          <div class="max-w-screen-xl mx-auto">
            ${this._phase !== "loaded"
              ? html`
                  <div
                    class="drop-zone relative overflow-hidden border-2 border-dashed border-slate-700 rounded-xl p-20 text-center cursor-pointer
                     hover:border-blue-500 hover:bg-blue-950/25 transition-all select-none"
                    @dragover=${this._onDragOver}
                    @dragleave=${this._onDragLeave}
                    @drop=${this._onDrop}
                    @click=${() => this.querySelector("#file-input").click()}
                  >
                    <svg
                      class="absolute inset-0 w-full h-full pointer-events-none"
                      preserveAspectRatio="none"
                      viewBox="0 0 800 400"
                      aria-hidden="true"
                    >
                      <path
                        d="M-20,90 C200,90 200,170 400,170 S600,80 820,80"
                        fill="none"
                        stroke="#6366f1"
                        stroke-width="44"
                        stroke-opacity="0.06"
                      />
                      <path
                        d="M-20,200 C200,200 200,250 400,250 S600,200 820,200"
                        fill="none"
                        stroke="#06b6d4"
                        stroke-width="34"
                        stroke-opacity="0.06"
                      />
                      <path
                        d="M-20,320 C200,320 200,270 400,270 S600,320 820,320"
                        fill="none"
                        stroke="#10b981"
                        stroke-width="26"
                        stroke-opacity="0.06"
                      />
                    </svg>
                    <div class="relative">
                      <svg
                        class="mx-auto mb-6"
                        width="64"
                        height="48"
                        viewBox="0 0 64 48"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M8 12 C 20 12, 20 11, 30 11"
                          stroke="#6366f1"
                          stroke-width="2.5"
                          stroke-opacity="0.55"
                          fill="none"
                        />
                        <path
                          d="M8 36 C 20 36, 20 37, 30 37"
                          stroke="#3b82f6"
                          stroke-width="2.5"
                          stroke-opacity="0.55"
                          fill="none"
                        />
                        <path
                          d="M36 11 C 46 11, 46 24, 56 24"
                          stroke="#06b6d4"
                          stroke-width="2.5"
                          stroke-opacity="0.55"
                          fill="none"
                        />
                        <path
                          d="M36 37 C 46 37, 46 24, 56 24"
                          stroke="#10b981"
                          stroke-width="2.5"
                          stroke-opacity="0.55"
                          fill="none"
                        />
                        <rect x="2" y="6" width="6" height="14" fill="#6366f1" rx="1.5" />
                        <rect x="2" y="28" width="6" height="14" fill="#3b82f6" rx="1.5" />
                        <rect x="30" y="0" width="6" height="22" fill="#06b6d4" rx="1.5" />
                        <rect x="30" y="26" width="6" height="22" fill="#10b981" rx="1.5" />
                        <rect x="56" y="14" width="6" height="20" fill="#f59e0b" rx="1.5" />
                      </svg>
                      <p class="text-slate-200 font-medium text-lg">
                        Drop your package-lock.json here
                      </p>
                      <p class="text-slate-500 text-sm mt-2">or click to browse</p>
                    </div>
                    ${this._error
                      ? html`
                          <p
                            class="text-red-400 text-sm mt-6 max-w-md mx-auto bg-red-950/40 border border-red-900/50 rounded-lg p-3"
                          >
                            ${this._error}
                          </p>
                        `
                      : ""}
                    <input
                      id="file-input"
                      type="file"
                      accept=".json"
                      class="hidden"
                      @change=${this._onFileInput}
                    />
                  </div>

                  ${this._savedFiles.length > 0
                    ? html`
                        <div class="mt-8">
                          <div
                            class="text-xs font-medium text-slate-500 uppercase tracking-widest mb-3 select-none"
                          >
                            Recent Files
                          </div>
                          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            ${(() => {
                              const maxPkg = Math.max(
                                1,
                                ...this._savedFiles.map((f) => f.pkgCount),
                              );
                              return this._savedFiles.map((f) => {
                                const ratio = f.pkgCount / maxPkg;
                                const segs = 7;
                                const filled = Math.max(1, Math.round(ratio * segs));
                                return html`
                                  <div
                                    @click=${() => this._loadJson(JSON.parse(f.raw))}
                                    class="group relative cursor-pointer rounded-lg overflow-hidden border border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-700/40 transition-colors select-none text-left"
                                  >
                                    <div class="h-[3px] flex">
                                      ${Array.from(
                                        { length: segs },
                                        (_, i) => html`
                                          <div
                                            class="flex-1"
                                            style="background:${i < filled
                                              ? DEPTH_COLORS[Math.min(i, DEPTH_COLORS.length - 1)]
                                              : "#1e293b"};${i > 0
                                              ? "margin-left:1px;"
                                              : ""}opacity:${i < filled ? 0.85 : 1}"
                                          ></div>
                                        `,
                                      )}
                                    </div>
                                    <div class="px-4 py-3">
                                      <button
                                        @click=${(e) => this._deleteFile(f.id, e)}
                                        class="absolute top-3 right-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all w-6 h-6 flex items-center justify-center rounded"
                                        title="Remove"
                                      >
                                        ✕
                                      </button>
                                      <div class="text-slate-200 font-medium truncate pr-6">
                                        ${f.name}
                                      </div>
                                      <div class="flex items-baseline gap-1.5 mt-1">
                                        <span
                                          class="text-slate-300 text-sm font-medium tabular-nums"
                                          >${f.pkgCount.toLocaleString()}</span
                                        >
                                        <span class="text-slate-500 text-xs">packages</span>
                                      </div>
                                      <div class="text-slate-600 text-xs mt-0.5">
                                        ${new Date(f.savedAt).toLocaleDateString(undefined, {
                                          month: "short",
                                          day: "numeric",
                                          year: "numeric",
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                `;
                              });
                            })()}
                          </div>
                        </div>
                      `
                    : ""}
                `
              : ""}
            ${this._phase === "loaded"
              ? html`
                  ${this._topPackages?.length
                    ? html`
                        <div class="mb-5">
                          <div
                            class="text-xs font-medium text-slate-500 uppercase tracking-widest mb-3 select-none"
                          >
                            Largest Dependency Trees
                          </div>
                          <div class="flex gap-3">
                            ${this._topPackages.map(
                              (p) => html`
                                <div
                                  @click=${() => this._focusPackage(p.name)}
                                  class="flex-1 cursor-pointer rounded-lg px-4 py-3 border transition-colors select-none
                                    ${this._focusedPackage === p.name
                                    ? "border-slate-300 bg-slate-700/60"
                                    : "border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-700/40"}"
                                >
                                  <div class="text-sm font-medium text-slate-200">${p.name}</div>
                                  <div class="text-xs text-slate-500 mt-0.5">
                                    ${p.treeSize} pkg tree
                                  </div>
                                </div>
                              `,
                            )}
                          </div>
                        </div>
                      `
                    : ""}
                  <div
                    class="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden"
                  >
                    <div class="overflow-x-auto p-4">
                      <div id="sankey-container" class="w-full"></div>
                    </div>
                    <div
                      class="border-t border-slate-700/60 bg-slate-900/40 px-4 py-3 flex items-center justify-center gap-5 flex-wrap"
                    >
                      ${DEPTH_COLORS.map((color, i) => {
                        const label =
                          i === 0
                            ? "Direct"
                            : i < DEPTH_COLORS.length - 1
                              ? `Depth ${i + 1}`
                              : `Depth ${i + 1}+`;
                        const activeIdx = Math.min(
                          (this._selectedDepth ?? 1) - 1,
                          DEPTH_COLORS.length - 1,
                        );
                        const isActive = i === activeIdx;
                        return html`
                          <div
                            class="flex items-center gap-1.5 text-sm cursor-pointer select-none transition-colors
                             ${isActive ? "text-slate-100" : "text-slate-500 hover:text-slate-300"}"
                            @click=${() => this._setDepthFromLegend(i)}
                          >
                            <span
                              style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;
                        ${isActive ? `box-shadow:0 0 0 2px ${color}55` : ""}"
                            ></span>
                            ${label}
                          </div>
                        `;
                      })}
                      <span class="text-slate-700 select-none mx-1">|</span>
                      <div class="flex items-center gap-1.5 text-sm" style="color:#c026d3">
                        <span
                          style="width:10px;height:10px;border-radius:50%;background:#c026d3;display:inline-block;flex-shrink:0"
                        ></span>
                        Version conflict
                      </div>
                      ${this._vulnStatus === "done" && this._vulnMap?.size
                        ? html`
                            <div class="flex items-center gap-1.5 text-sm text-slate-400">
                              <span style="display:flex;gap:2px;flex-shrink:0">
                                ${["#fbbf24", "#f59e0b", "#f97316", "#ef4444"].map(
                                  (c) =>
                                    html`<span
                                      style="width:6px;height:10px;border-radius:2px;background:${c};display:inline-block"
                                    ></span>`,
                                )}
                              </span>
                              Audit (low→critical)
                            </div>
                          `
                        : ""}
                      <div class="flex items-center gap-1.5 text-sm text-slate-400">
                        <svg width="16" height="10" style="flex-shrink:0">
                          <line
                            x1="0"
                            y1="5"
                            x2="16"
                            y2="5"
                            stroke="#94a3b8"
                            stroke-width="2"
                            stroke-dasharray="4 2"
                          />
                        </svg>
                        Peer dependency
                      </div>
                    </div>
                  </div>
                `
              : ""}
          </div>
        </div>
        ${this._optionalGroup ? this._renderOptionalDialog() : ""}
      </div>
    `;
  }

  _renderOptionalDialog() {
    const g = this._optionalGroup;
    const close = () => (this._optionalGroup = null);
    return html`
      <div
        style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px"
        @click=${close}
      >
        <div
          class="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl"
          style="max-width:520px;width:100%;max-height:80vh;display:flex;flex-direction:column"
          @click=${(e) => e.stopPropagation()}
        >
          <div class="px-5 py-4 border-b border-slate-700">
            <div class="flex items-center gap-2">
              <span
                style="color:#f59e0b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em"
                >Optional</span
              >
              <span class="text-slate-300 font-medium">${g.parentName}</span>
            </div>
            <div class="text-xs text-slate-500 mt-1">
              ${g.alternatives.length} packages listed · typically only 1 installs (per OS/CPU) ·
              all are scanned by audit
            </div>
          </div>
          <div style="overflow-y:auto;padding:8px 12px">
            ${g.alternatives.map((alt) => {
              const vulns = this._vulnMap?.get(alt.id);
              const link = getRegistryLink(alt);
              return html`
                <div
                  class="flex items-center justify-between py-2 px-2 rounded hover:bg-slate-700/40 cursor-pointer gap-2"
                  @click=${() => {
                    this._optionalGroup = null;
                    this._focusPackage(alt.name);
                  }}
                >
                  <div style="min-width:0">
                    <div
                      class="text-sm text-slate-200"
                      style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                    >
                      ${alt.name}
                    </div>
                    <div class="text-xs text-slate-500">v${alt.version}</div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    ${vulns?.length
                      ? html`<span
                          style="font-size:10px;color:#ef4444;background:#1f1010;border:1px solid #ef444444;border-radius:3px;padding:1px 5px;white-space:nowrap"
                          >⚠ ${vulns.length}</span
                        >`
                      : ""}
                    ${link
                      ? html`<a
                          href=${link.url}
                          target="_blank"
                          rel="noopener"
                          title="View on ${link.label}"
                          class="text-slate-600 hover:text-slate-300 transition-colors flex items-center"
                          @click=${(e) => e.stopPropagation()}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </a>`
                      : ""}
                  </div>
                </div>
              `;
            })}
          </div>
          <div class="px-5 py-3 border-t border-slate-700 flex justify-end">
            <button
              class="text-sm text-slate-400 hover:text-slate-200 cursor-pointer"
              @click=${close}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
