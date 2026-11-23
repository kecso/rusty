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
| `http://127.0.0.1:8888/docs` | **Built Documentation & Tutorials** (this site, when `npm run docs:build` has been run; also served at `/routers/studio/docs/`) |

### User-Facing / Production Mode (`npm run start:prod`)

For user-facing deployments where exposing WebGME's generic editor could confuse non-experts or guest access should not be allowed:

- **Authentication is required** (`allowGuests = false`, redirecting unauthenticated visitors to `/profile/login`, supporting Layer 1 OAuth/OIDC or WebGME passwords), and Rusty Studio exposes **`User Profile`** (`/profile` — project access, repository bindings, and 1-to-1 GitHub App linking) and **`Log out`** (`/logout`) buttons in the top bar.
- **`/` and `/index.html` serve Rusty Studio directly**, and the **WebGME Generic UI** is disabled (in all deployments, Rusty Studio keeps the workspace focused without a generic WebGME UI link in the header).
- Running **`npm run docs:build`** automatically enables `/docs` and shows the **`Docs ↗`** link in the top bar.
- You can also mix modes in dev via environment variables (`RUSTY_STUDIO_ONLY=true`, `RUSTY_SERVE_WEBGME_UI=true`, `RUSTY_ROOT_TO_STUDIO=true`, `RUSTY_AUTH=true`).

On first launch in guest/dev mode, Rusty Studio automatically creates a WebGME project called **`RustyDemo`** seeded from `seed/RustySeed.webgmex`.

::: tip Counter Tutorial + Pre-Seeded Demo Showcases
- **Build from scratch**: Follow [Tutorial 1: Build a Simple Counter](./tutorial/00-build-a-counter.md) to sign in via GitHub, connect your fork directory, design states/globals/events/guards, and export a standalone crate.
- **Pre-seeded demos in `RustySeed.webgmex`**: Use the **Machine** dropdown to tour **`BlinkyController`** ([Blinky Showcase](./tutorial/01-blinky-quickstart.md)) and **`SmartThermostat`** ([SmartThermostat Showcase](./tutorial/02-smart-thermostat.md)).
:::

## 2. Connecting Your Fork's `dev` Branch for GitHub Testing

Both pre-seeded machines configure `GitArtifactLink` at the **`StateMachine` directory level**:

- `gitOwner`: *(left blank so you connect your own GitHub username)*
- `gitRepo`: `rusty`
- `gitBranch`: **`dev`**
- `gitPath`: `examples/blinky` or `examples/smart-thermostat` *(states resolve cleanly to `<dir>/src/states/<state>.rs`)*

Before connecting a repository, Studio works cleanly in **Local Draft Mode**. When ready to connect your machine to GitHub (one-time setup per machine), click **`Connect Git Repository…`** to fill in **`<your-username>/rusty`** on **`dev`**—and optionally choose **Connect & import existing Rust code (one-time)** if that directory already contains Rust source files you want to sweep into the machine.

See [Tutorial 3: GitHub Sync & Directory Import](./tutorial/04-github-sync-dev.md) for setting up `.env` and GitHub App OAuth.
