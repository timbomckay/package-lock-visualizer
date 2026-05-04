# Package Lock Visualizer

Drop in a `package-lock.json` and explore your dependency tree as an interactive Sankey diagram. Spot version conflicts, trace transitive dependencies, and see where bloat is coming from.

<img width="2472" height="2002" alt="Package Lock Visualizer screenshot" src="https://github.com/user-attachments/assets/16125362-78df-4418-bfa1-49e806f6dc78" />

## Features

- Drag-and-drop a `package-lock.json` — everything runs locally in your browser
- Interactive Sankey layout of direct and transitive dependencies
- Highlights version conflicts where multiple versions of the same package are resolved
- Click a node to focus its subtree
- Recent files are remembered for quick re-opening

## Running locally

No build step. Serve the directory with anything:

```sh
npx serve .
```

Then open the printed URL.

## How it works

### Parsing the lockfile

The tool reads `lock.packages` — the flat map keyed by install path that npm writes in [lockfile v2/v3](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json). From each entry it pulls `version`, the `dev`/`peer` flags, and all four dependency groups (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`). The empty-path entry (`""`) is the project root.

### Nodes are `name@version`, not install paths

The same package version can be installed at many paths under nested `node_modules`. The visualizer collapses all of those into a **single node per `name@version`**. So if `lodash@4.17.21` is hoisted at the top and also nested under three other packages, you see one node with four incoming links — not four nodes.

This is the biggest reason the diagram looks different from `npm ls`. `npm ls` prints a tree where the same package appears once per path it's installed at; the Sankey deduplicates so you can actually see what depends on what.

### Links and version resolution

For every dependency declared by a package, the tool finds the installed version that satisfies the declared [semver range](https://github.com/npm/node-semver#ranges) using `semver.maxSatisfying` against everything present in the lockfile. That resolved `name@version` becomes the link target. Duplicate `source→target` pairs are collapsed.

`peerDependencies` only produce links if the target node is itself marked `isPeer` in the lockfile. `bundledDependencies` aren't given special treatment. `devDependencies` and `optionalDependencies` are merged into the dependency set; the **Prod / Dev** filter in the UI hides nodes flagged `dev`.

### Depth — and why it differs from `npm ls`

Depth in the [Sankey diagram](https://en.wikipedia.org/wiki/Sankey_diagram) is the **longest path from the root** to a node (computed by walking the graph and taking `max(parent.depth) + 1`). d3-sankey then uses this for left-aligned column placement.

`npm ls --depth=N` instead caps recursion in the print tree. Because shared dependencies in the Sankey collapse to one node, that node shows up at its furthest depth from root, not its shallowest. A package that's a direct dep *and* a transitive dep three levels down will sit in the deeper column.

The depth filter in the UI uses the same longest-path metric, so it's internally consistent — just don't expect the count to match `npm ls`'s.

### Version conflicts

If the same package name resolves to more than one version anywhere in the tree, every node for that name is flagged `isConflict` and rendered in magenta. The tooltip lists all the conflicting versions so you can see which paths pulled which.

### Vulnerabilities (OSV.dev)

Once the graph is built, every `name@version` node is sent in batches of 1000 to OSV's `querybatch` endpoint with ecosystem `npm`. The batch response only returns vuln IDs, so the unique IDs are then fetched individually (concurrency 10) for full details. Severity is read from `database_specific.severity` when present, otherwise computed from the [CVSS v3](https://www.first.org/cvss/v3.1/specification-document) vector — `≥9.0 critical`, `≥7.0 high`, `≥4.0 moderate`, otherwise low.

### Cycles, focus, and the depth-1 list view

Cycles in the resolved graph are broken with a [DFS](https://en.wikipedia.org/wiki/Depth-first_search) pass before layout — d3-sankey requires a [DAG](https://en.wikipedia.org/wiki/Directed_acyclic_graph). Clicking a node enters **focus mode**, which keeps only that node's ancestors and descendants. At depth 1, the Sankey is replaced with a sorted list of direct dependencies showing tree size and any vulnerability badges.

## Stack

Plain HTML + ES modules via import maps — [Lit](https://lit.dev), [d3](https://d3js.org), [d3-sankey](https://github.com/d3/d3-sankey), [semver](https://github.com/npm/node-semver), and [Tailwind](https://tailwindcss.com) (browser build). Vulnerability data from the [OSV.dev](https://osv.dev) API.
