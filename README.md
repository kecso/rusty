# rusty

Rust state-machine modeling & simulation studio built as the poster-child **WebGME + [`webgme-git`](https://github.com/kecso/webgme-git)** application:

- **WebGME owns topology & data** (`StateMachine`, `State`, `Transition`, `GlobalVar`, `EventDef`, canvas positions, and `GitArtifactLink` coordinates). The Rusty Studio UI connects directly to the live WebGME server via `GME.classes.Client` (`/gme-dist/webgme.classes.build.js`), subscribes to live WebGME territories, and commits every edit inside WebGME transactions.
- **GitHub owns per-state Rust behavior** via `webgme-git`: embedded self-hosted **Monaco Editor** auto-fetches state files on edit via Octokit (`/routers/gitrouter/tree`), validates code in **< 1ms** via `RustyAnalyzer`, and commits+pushes atomically on `⌘S` / `Ctrl+S` (`/routers/gitrouter/commit`) with transparent auto-rebase and HTTP 409 3-way conflict resolution.
- **Dual-tier web-based dynamic simulation**:
  1. **Instant In-Browser Dynamic Simulator** (`src/common/rustSimEngine.js`): executes `on_enter` / `on_event` / `on_exit`, payload events, `Outcome::Emit(...)`, math/clamp expressions, and transition guards live with animated SVG state/edge highlights and fault injection.
  2. **Real `rustc` / `cargo` Verification & Native Trace Parity** (`/routers/rustsim`): generates a standalone Rust crate and runs `cargo check` / `cargo run` to overlay compiler markers in Monaco and verify 100% behavioral parity with the browser simulation.

## Tutorial Examples & Safe `dev` Sandbox Branch

Two complete, runnable tutorial models are pre-seeded in `seed/RustySeed.webgmex` and materialized under [`examples/`](./examples/README.md), with their `GitArtifactLink` coordinates bound to `kecso/rusty` on the **`dev`** branch so you can test live GitHub fetch/commit/push without touching `main`:

- [`examples/blinky/`](./examples/blinky) — **BlinkyController**: hello-world GPIO blink loop, thermal limit guard, `Fault` / `Reset` recovery.
- [`examples/smart-thermostat/`](./examples/smart-thermostat) — **SmartThermostat**: physics-computing HVAC controller with `f64` thermal drift & `energy_wh`, payload events (`SetTarget(f64)`, `SetAmbient(f64)`), `Outcome::Emit(Event::OverheatAlert)`, `Cooldown`, and `SafeLockout`.

## Tutorial Documentation (VitePress)

A complete "Read the Docs"-style interactive tutorial & reference site lives in [`docs/`](./docs/index.md):

```bash
npm run docs:dev     # Live local VitePress docs server
npm run docs:build   # Build static docs served at http://127.0.0.1:8888/routers/studio/docs/
```

## Architecture

| Component | Path | Role |
| --- | --- | --- |
| WebGME Server | `app.js`, `config/` | Standalone WebGME host wiring `webgme-git`, seeds, plugins, and routers |
| Metamodel & Seed | `metamodel/Language.json`, `seed/RustySeed.webgmex` | `GitArtifactLink` mixin + `StateMachine`, `State`, `Transition`, `GlobalVar`, `EventDef` + both example models |
| Tutorial Examples | `examples/blinky/`, `examples/smart-thermostat/` | Standalone runnable Cargo crates bound to the `dev` branch |
| Documentation Site | `docs/` | VitePress tutorials, architecture concepts, and metamodel/diagnostics reference |
| `webgme-git` Adapter | `src/routers/GitRouterAdapter/` | Mounts `webgme-git/src/routers/GitRouter` at `/routers/gitrouter` wired to `gmeAuth` + `ProjectRepoStore` |
| Rust Sim / Check Router | `src/routers/RustSimRouter/` | `/routers/rustsim` (`GET /health`, `POST /generate`, `POST /check`, `POST /run`) |
| Rusty Studio UI | `src/routers/StudioRouter/` | Served at `/routers/studio` (with `/docs` & self-hosted Monaco); reads/writes via `GME.classes.Client` |
| Shared Rust Engine | `src/common/` | UMD modules (`rustContract.js`, `rustAnalyzer.js`, `rustCodegen.js`, `rustSimEngine.js`) |
| WebGME Plugin | `src/plugins/GenerateRustCrate/` | Server/browser WebGME plugin exporting the generated Rust crate artifact |

## Quick Start

### 1. Prerequisites
- Node.js >= 18
- MongoDB (`mongod` on `127.0.0.1:27017`)
- Rust toolchain (`rustc` + `cargo`)

### 2. Install & Run (Local Dev / Guest Mode)

```bash
cd rusty
npm install
npm run docs:build   # Optional: builds /routers/studio/docs/
npm start
```

Open:
- **Rusty Studio**: `http://127.0.0.1:8888/routers/studio`
- **Built Tutorials**: `http://127.0.0.1:8888/routers/studio/docs/`
- **WebGME Generic UI**: `http://127.0.0.1:8888/`

### 3. Enable Full GitHub Sync (`webgme-git` OAuth + `/profile`)

```bash
cp .env.example .env
# Fill in GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET,
# GITHUB_APP_PRIVATE_KEY_PATH, TOKEN_ENCRYPTION_KEY (openssl rand -hex 32)
# and set RUSTY_AUTH=true
npm start
```

1. Sign in with GitHub at `http://127.0.0.1:8888/profile/login`
2. Link `kecso/rusty` to your project in `/profile`
3. In **Rusty Studio**, select `SmartThermostat` or `BlinkyController` — both are already bound to `kecso/rusty@dev`!

## Scripts

```bash
npm start          # Start WebGME server + Rusty Studio
npm test           # Run unit, router, analyzer, codegen, and native Rust parity tests
npm run sync:examples # Regenerate examples/ from src/common/rustContract.js
npm run build:seed # Rebuild seed/RustySeed.webgmex from metamodel/Language.json
npm run docs:dev   # Preview VitePress tutorial docs locally
npm run docs:build # Build VitePress docs for /routers/studio/docs/
```

## Local Co-Development (`npm link`)

`package.json` depends directly on the GitHub sources (`github:kecso/webgme-git` and `github:kecso/webgme-json-importer`) with zero relative `file:` paths. When developing those libraries side-by-side locally, use `npm link`:

```bash
# 1. Register shared local packages once:
(cd /path/to/webgme-json-importer && npm link)
(cd /path/to/webgme-git && npm link && npm link webgme-json-importer)

# 2. Link them into rusty after npm install:
npm install
npm link webgme-git webgme-json-importer
```

## License

MIT
