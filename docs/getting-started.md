# Getting Started

This guide walks you through running **Rusty Studio** locally, exploring the pre-seeded tutorial models (`BlinkyController` and `SmartThermostat`), and optionally enabling live GitHub OAuth sync against the safe **`dev`** sandbox branch.

## Prerequisites

- **Node.js** `>= 18`
- **MongoDB** (e.g. `mongod` listening on `127.0.0.1:27017`)
- **Rust toolchain** (`rustc` and `cargo`) for compiler diagnostics and native trace parity

## 1. Install and Start

```bash
cd rusty
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

## 2. Using the Safe `dev` Branch for GitHub Testing

Both tutorial models in `RustySeed.webgmex` have their `GitArtifactLink` attributes pre-bound to:

- `gitOwner`: `kecso`
- `gitRepo`: `rusty`
- `gitBranch`: **`dev`**
- `gitPath`: `examples/blinky/src/states/<state>.rs` or `examples/smart-thermostat/src/states/<state>.rs`

Because they point to **`dev`** instead of `main`, you can freely edit Rust code in Monaco, press `⌘S` / `Ctrl+S` to commit and push through `webgme-git`, test auto-rebase, and intentionally trigger merge conflicts without ever touching `main`.

See [Tutorial 4: Testing GitHub Sync on `dev`](./tutorial/04-github-sync-dev.md) for setting up `.env` and GitHub App OAuth.
