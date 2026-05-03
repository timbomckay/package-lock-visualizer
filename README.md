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

## Stack

Plain HTML + ES modules via import maps — [Lit](https://lit.dev), [d3](https://d3js.org), [d3-sankey](https://github.com/d3/d3-sankey), [semver](https://github.com/npm/node-semver), and [Tailwind](https://tailwindcss.com) (browser build).
