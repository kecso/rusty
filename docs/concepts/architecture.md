# WebGME + `webgme-git` Architecture

Rusty is designed as a clean separation of concerns between **structural modeling** (WebGME) and **behavioral source code** (GitHub via `webgme-git`).

## Separation of Truth

```
┌─────────────────────────────────────────────────────────────────────────┐
│ WebGME Server (app.js)                                                  │
│                                                                         │
│  ├── GME Storage / MongoDB ──▶ StateMachine, State, Transition,         │
│  │                             GlobalVar, EventDef, GitArtifactLink     │
│  │                                                                      │
│  ├── /routers/studio       ──▶ Rusty Studio SPA (GME.classes.Client)    │
│  │     ├── SVG Diagram Canvas (canvasView.js)                           │
│  │     ├── Embedded Monaco Editor + RustyAnalyzer (sub-ms checks)       │
│  │     └── In-Browser Dynamic Simulator (rustSimEngine.js)              │
│  │                                                                      │
│  ├── /routers/gitrouter    ──▶ webgme-git GitRouterAdapter (Octokit)    │
│  │     ├── GET /tree  (fetch state .rs file on edit)                    │
│  │     └── POST /commit (atomic tree commit + auto-rebase + 409 diff)   │
│  │                                                                      │
│  ├── /profile              ──▶ webgme-git GitHub OAuth & Repo Allowlist │
│  └── /routers/rustsim      ──▶ rustCodegen.js + cargo check / cargo run │
└─────────────────────────────────────────────────────────────────────────┘
```

## How Data Flows to the Studio UI

The Rusty Studio SPA **never keeps a shadow JSON database** of your model:

1. [`webgmeBridge.js`](https://github.com/kecso/rusty/blob/main/src/routers/StudioRouter/public/webgmeBridge.js) loads `/gme-dist/webgme.classes.build.js` and `/gmeConfig.json` directly from the running WebGME server.
2. It opens a live WebGME territory (`"": { children: 2 }`) via `GME.classes.Client`.
3. Every change — dragging a state box on the canvas, adding a `GlobalVar`, creating a `Transition`, updating a `GitArtifactLink`, or saving `codeCache` — runs inside `client.startTransaction(...)` / `client.completeTransaction(...)`.
4. If you open the **exact same project** in the stock WebGME Generic UI (`/`), edits made in either window appear live in the other.

## Dual-Tier Simulation & Verification

Rather than forcing a slow server-side compile round-trip on every click, Rusty gives you two complementary execution layers backed by a single shared code model:

| Tier | Engine | Latency | Purpose |
| --- | --- | --- | --- |
| **1. Edit-Time Checks** | `RustyAnalyzer` (browser) | `< 1 ms` | Red/yellow Monaco squiggles on `globals.*`, `Event::*`, `Outcome::Emit`, `StateId::*`, braces |
| **2. Interactive Sim** | `RustySimEngine` (browser) | Instant | Animated state/edge trace, Auto-Tick loop, event injection, live `Globals` fault override |
| **3. Compiler & Parity** | `/routers/rustsim` (`cargo`) | `~0.4–1 s` | Real `rustc` typecheck markers + native binary replay verifying trace parity |
