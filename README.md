# rusty

Rust state-machine modeling & simulation studio built as the poster-child **WebGME + [`webgme-git`](../webgme-git)** application:

- **WebGME owns topology & data** (`StateMachine`, `State`, `Transition`, `GlobalVar`, `EventDef`, canvas positions, and `GitArtifactLink` coordinates). The Rusty Studio UI connects directly to the live WebGME server via `GME.classes.Client` (`/gme-dist/webgme.classes.build.js`), subscribes to live WebGME territories, and commits every edit inside WebGME transactions.
- **GitHub owns per-state Rust behavior** via `webgme-git` (`GitArtifactLink` mixin on `State` and `StateMachine`, `/routers/gitrouter` with atomic commits, transparent auto-rebase, and HTTP 409 3-way conflict resolution, plus `/profile` GitHub-native user & per-project repo access management).
- **Dual-tier web-based dynamic simulation**:
  1. **Instant In-Browser Dynamic Simulator** (`src/common/rustSimEngine.js`): executes each state's Rust `on_enter` / `on_event` / `on_exit` contract and transition guards live in the browser with animated SVG state/edge highlights, event injection, live globals watch + fault injection, and execution trace.
  2. **Real `rustc` / `cargo` Verification & Native Trace Parity** (`/routers/rustsim`): composes a self-contained Rust crate (`Cargo.toml`, `src/types.rs`, `src/machine.rs`, `src/states/*.rs`, `src/lib.rs`, `src/main.rs`) and runs `cargo check` / `cargo run` to surface real compiler diagnostics and verify 100% parity with the browser simulation.

## Architecture

| Component | Path | Role |
| --- | --- | --- |
| WebGME Server | `app.js`, `config/` | Standalone WebGME host wiring `webgme-git`, seeds, plugins, and routers |
| Metamodel & Seed | `metamodel/Language.json`, `seed/RustySeed.webgmex` | `GitArtifactLink` mixin + `StateMachine`, `State`, `Transition`, `GlobalVar`, `EventDef` + starter `BlinkyController` |
| `webgme-git` Adapter | `src/routers/GitRouterAdapter/` | Mounts `webgme-git/src/routers/GitRouter` at `/routers/gitrouter` wired to `gmeAuth` + `ProjectRepoStore` |
| Rust Sim / Check Router | `src/routers/RustSimRouter/` | `/routers/rustsim` (`GET /health`, `POST /generate`, `POST /check`, `POST /run`) |
| Rusty Studio UI | `src/routers/StudioRouter/` | Served at `/routers/studio`; reads/writes live WebGME projects via `GME.classes.Client` |
| Shared Rust Engine | `src/common/` | UMD modules (`rustContract.js`, `rustCodegen.js`, `rustSimEngine.js`) shared by Node, WebGME plugins, and Browser |
| WebGME Plugin | `src/plugins/GenerateRustCrate/` | Server/browser WebGME plugin exporting the generated Rust crate artifact |

## Quick Start

### 1. Prerequisites
- Node.js >= 18
- MongoDB (e.g. `mongod` on `127.0.0.1:27017`)
- Rust toolchain (`rustc` + `cargo`) for server-side verification & native trace parity

### 2. Install & Run (Local Dev / Guest Mode)

```bash
cd rusty
npm install
npm start
```

Open:
- **Rusty Studio**: `http://127.0.0.1:8888/routers/studio` (automatically creates a `RustyDemo` project seeded from `RustySeed.webgmex` with the `BlinkyController` example on first launch)
- **WebGME Generic UI**: `http://127.0.0.1:8888/` (inspect the exact same live project, metamodel, `GitArtifactLink` mixin, and `GenerateRustCrate` plugin)

### 3. Enable Full GitHub Sync (`webgme-git` OAuth + `/profile`)

```bash
cp .env.example .env
# Fill in GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET,
# GITHUB_APP_PRIVATE_KEY_PATH, TOKEN_ENCRYPTION_KEY (openssl rand -hex 32)
# and set RUSTY_AUTH=true
npm start
```

1. Sign in with GitHub at `http://127.0.0.1:8888/profile/login`
2. Link repositories to your WebGME project in `/profile`
3. In **Rusty Studio**, click **Bind GitHub Repo…** to link your `StateMachine` and `State` nodes, then **Pull States** / **Sync All States** / **Push Full Crate**!

## Scripts

```bash
npm start          # Start WebGME server + Rusty Studio
npm test           # Run unit, router, and native Rust parity tests
npm run build:seed # Rebuild seed/RustySeed.webgmex from metamodel/Language.json
```

## License

MIT
