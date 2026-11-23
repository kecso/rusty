# Rusty Studio — Model-Driven Visual Rust State Machines

**Rusty Studio** is a full-stack visual state machine workbench built on **WebGME**, [`webgme-git`](https://github.com/kecso/webgme-git), **Monaco Editor**, and **native `cargo` / `rustc`**.

Design pure deterministic Rust state machines visually, prove transition guard mutual exclusivity mathematically at edit time, keep per-state Rust hooks synced cleanly to your own GitHub fork, and compile standalone Cargo crates verified identically in both the browser simulator and native Rust.

## Key Capabilities

- **Pure Classic State Machine Control Flow**: States define only `Entry` (`on_enter`) and `Exit` (`on_exit`) hooks; every event reaction is modeled explicitly as a per-state `Transition` (`on_exit -> tr_<slug> -> on_enter` for external transitions, or `tr_<slug>` only when `reenter = false`). State modules (`src/states/<state>.rs`) import only `use crate::types::Globals;`—never `StateId` or `Event::*`.
- **Formal Guard Language & Mutual-Exclusivity Prover (`src/common/rustGuardLang.js`)**: Pure Rust guard expressions + exact `BigInt` Rational Fourier-Motzkin Elimination & Integer Branch-and-Bound prove sibling guards mutually exclusive across every `(State, Event)` pair (using `GlobalVar` `minValue`/`maxValue` domain bounds), surfacing verified concrete counterexamples whenever transitions overlap.
- **Contextual Strictly Read-Only Monaco Editor**: State Inspector (`Entry` | `Exit` | `Transitions`) and Transition Inspector (`Guard & Exclusivity` | `Action Hook`) show the complete composed `src/states/<state>.rs` file scrolled to the exact hook with surrounding headers, signatures, and sibling functions dimmed and locked read-only.
- **Hybrid WebGME + `webgme-git` Storage**: WebGME stores visual topology, `dependsOn` Sets, pure guards, and metadata; GitHub stores `examples/<machine>/src/states/<state>.rs` with atomic push (`⌘S`), auto-rebase, HTTP 409 3-way conflict resolution, and one-time directory import.
- **Instant Checks + Native Cargo Verification (`/routers/rustsim`)**: Sub-millisecond diagnostics (`RUSTY_G*`, `RUSTY_E*`, `DESIGN_*`), interactive fixed layered diagram layout (`LR`/`TB`, compact event badges `A..Z`, fanned self-loops), and one-click `cargo check` / `cargo run` trace parity.
- **Dev & User-Facing Deployment Modes**: `npm start` exposes both Studio (`/routers/studio`) and WebGME generic UI (`/`); `npm run start:prod` serves Studio cleanly at `/` with authentication enabled and `/docs` tutorials integrated.

## Quickstart (Fork Workflow)

```bash
# 1. Fork https://github.com/kecso/rusty on GitHub, then clone your fork
git clone https://github.com/<your-username>/rusty.git
cd rusty
git checkout -b dev && git push -u origin dev
git checkout main

# 2. Install & start WebGME + Rusty Studio
npm install
npm start
```

Open **`http://127.0.0.1:8888/routers/studio`** to tour the pre-seeded **`BlinkyController`** (`examples/blinky/`) and **`SmartThermostat`** (`examples/smart-thermostat/`) state machines or build the **Counter** tutorial from scratch.

## Commands & Verification

| Command | Purpose |
| --- | --- |
| `npm start` / `npm run start:dev` | Start in Dev mode (`/routers/studio`, WebGME generic UI at `/`, optional guest access) |
| `npm run start:prod` | Start in User-Facing mode (`/` -> Studio, auth required, `User Profile` & `Log out`) |
| `npm test` | Run all 7 Node unit/integration test suites (28 tests) |
| `npm run build:seed` | Rebuild `seed/RustySeed.webgmex` purely in memory (no MongoDB required) |
| `npm run sync:examples` | Regenerate `examples/blinky` and `examples/smart-thermostat` crates + manifests |
| `npm run docs:dev` / `npm run docs:build` | Preview or build the VitePress documentation portal (`/docs`) |

## Documentation

Full guides, tutorials, metamodel references, and diagnostic catalogs live in **`docs/`** (`npm run docs:build` compiles them into `docs/.vitepress/dist`, automatically served at `/docs` by Rusty Studio):

- [Getting Started & Deployment Modes](./docs/getting-started.md)
- [Model-Driven Architecture & Guard Prover](./docs/concepts/model-driven-architecture.md)
- [Tutorial 1: Build a Counter from Scratch](./docs/tutorial/00-build-a-counter.md)
- [Showcase: BlinkyController](./docs/tutorial/01-blinky-quickstart.md) & [SmartThermostat](./docs/tutorial/02-smart-thermostat.md)
- [Tutorial 2: Guard Proofs, Edit-Time Checks & Design Impact](./docs/tutorial/03-edit-time-checks.md)
- [Tutorial 3: GitHub Sync & Directory Import](./docs/tutorial/04-github-sync-dev.md)
- [Tutorial 4: Standalone Crate & Native `rustc` Parity](./docs/tutorial/05-codegen-and-native.md)
