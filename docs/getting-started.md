# Getting Started

This guide walks you through forking **`kecso/rusty`**, running **Rusty Studio** locally, exploring the pre-seeded tutorial models (`BlinkyController` and `SmartThermostat`), and enabling live GitHub OAuth sync against a safe **`dev`** branch on **your own fork**.

## Prerequisites

- **Node.js** `>= 18`
- **MongoDB** (e.g. `mongod` listening on `127.0.0.1:27017`)
- **Rust toolchain** (`rustc` and `cargo`) for compiler diagnostics and native trace parity
- A free GitHub account if you want to test live `webgme-git` push/rebase workflows

## 1. Fork, Clone, and Create Your `dev` Branch

1. Fork [`https://github.com/kecso/rusty`](https://github.com/kecso/rusty) to your own GitHub account (`https://github.com/<your-username>/rusty`).
2. Clone **your fork**, create a personal `dev` sandbox branch on it, and install/start Rusty Studio:

```bash
git clone https://github.com/<your-username>/rusty.git
cd rusty

# Create a safe 'dev' sandbox branch on YOUR fork for live GitHub sync tests
git checkout -b dev
git push -u origin dev

# Return to main (or stay on dev) and install dependencies
git checkout main
npm install
npm start
```

The server starts WebGME and supports two deployment UI modes:

### Dev Mode (`npm start` or `npm run start:dev`)

Both **Rusty Studio** and the **WebGME Generic UI** are available side by side:

| URL | Purpose |
| --- | --- |
| `http://127.0.0.1:8888/routers/studio` | **Rusty Studio IDE** (Diagram + Monaco + Simulator) |
| `http://127.0.0.1:8888/` | **WebGME Generic UI** (Meta-Editor, tree browser, plugins) |
| `http://127.0.0.1:8888/routers/studio/docs/` | **Built Documentation & Tutorials** (this site) |

### User-Facing / Studio-Only Mode (`npm run start:prod` or `RUSTY_STUDIO_ONLY=true`)

For end-user deployments where exposing WebGME's generic editor could confuse non-experts:

- **`/` and `/index.html` serve Rusty Studio directly**, and the **WebGME Generic UI** is disabled.
- The **`WebGME UI ↗`** header button in Rusty Studio automatically hides itself.
- You can also combine flags (`RUSTY_SERVE_WEBGME_UI=true` + `RUSTY_ROOT_TO_STUDIO=true`) to make `/` open Rusty Studio while keeping WebGME reachable at `/index.html`.

On first launch in guest/dev mode, Rusty Studio automatically creates a WebGME project called **`RustyDemo`** seeded from `seed/RustySeed.webgmex`.

::: tip Counter Tutorial + Pre-Seeded Demo Showcases
- **Build from scratch**: Follow [Tutorial 1: Build a Simple Counter](./tutorial/00-build-a-counter.md) to sign in via GitHub, bind your fork directory, design states/globals/events/guards, and export a standalone crate.
- **Pre-seeded demos in `RustySeed.webgmex`**: Use the **Machine** dropdown to tour **`BlinkyController`** ([Blinky Showcase](./tutorial/01-blinky-quickstart.md)) and **`SmartThermostat`** ([SmartThermostat Showcase](./tutorial/02-smart-thermostat.md)).
:::

## 2. Binding Your Fork's `dev` Branch for GitHub Testing

Both pre-seeded machines configure `GitArtifactLink` at the **`StateMachine` directory level**:

- `gitOwner`: *(left blank so you bind your own GitHub username)*
- `gitRepo`: `rusty`
- `gitBranch`: **`dev`**
- `gitPath`: `examples/blinky` or `examples/smart-thermostat` *(states resolve cleanly to `<dir>/src/states/<state>.rs`, with optional per-state overrides)*

Until you bind an owner, Studio works cleanly in **Local Draft Mode**. When ready to push real commits, click **Bind GitHub Repo…** to fill in **`<your-username>/rusty`** on **`dev`**, or click **↓ Import from GitHub…** to rebuild a WebGME machine directly from any GitHub Rust crate directory.

See [Tutorial 3: GitHub Sync & Directory Import](./tutorial/04-github-sync-dev.md) for setting up `.env` and GitHub App OAuth.
