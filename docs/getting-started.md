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

The server starts WebGME and mounts three routers:

| URL | Purpose |
| --- | --- |
| `http://127.0.0.1:8888/routers/studio` | **Rusty Studio IDE** (Diagram + Monaco + Dynamic Simulator) |
| `http://127.0.0.1:8888/` | **WebGME Generic UI** (Meta-Editor, tree browser, `GenerateRustCrate` plugin) |
| `http://127.0.0.1:8888/routers/studio/docs/` | **Built Documentation & Tutorials** (this site) |

On first launch in guest/dev mode, Rusty Studio automatically creates a WebGME project called **`RustyDemo`** seeded from `seed/RustySeed.webgmex`.

::: tip Two Ready-to-Run Tutorial Models
`RustySeed.webgmex` contains two complete `StateMachine` models inside `ROOT`:
1. **`BlinkyController`** — a 4-state hardware blink + thermal fault controller ([Tutorial 1](./tutorial/01-blinky-quickstart.md)).
2. **`SmartThermostat`** — a 5-state physics-computing HVAC controller with floating-point math, payload events, and self-emitted safety alerts ([Tutorial 2](./tutorial/02-smart-thermostat.md)).

Use the **Machine** selector in the top bar of Rusty Studio to switch between them at any time.
:::

## 2. Binding Your Fork's `dev` Branch for GitHub Testing

Both tutorial models in `RustySeed.webgmex` pre-configure `GitArtifactLink` with:

- `gitOwner`: *(left blank so you bind your own GitHub username)*
- `gitRepo`: `rusty`
- `gitBranch`: **`dev`**
- `gitPath`: `examples/blinky/src/states/<state>.rs` or `examples/smart-thermostat/src/states/<state>.rs`

Until you bind an owner, Studio works cleanly in **Local Draft Mode** (you can edit, simulate, and run `rustc` without signing into GitHub). When you are ready to test real Octokit commits, click **Bind GitHub Repo…** in Studio's `GitArtifactLink` bar to fill in **`<your-username>/rusty`** on **`dev`** — you will push to your own fork without needing write access to `kecso/rusty`.

See [Tutorial 4: Testing GitHub Sync on Your Fork's `dev` Branch](./tutorial/04-github-sync-dev.md) for setting up `.env` and GitHub App OAuth.
