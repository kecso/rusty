# Architecture: WebGME Visual Metamodel + GitHub Code

Rusty avoids storing canonical source code in opaque binary database blobs. Instead, it cleanly separates **design topology, pure guards, and invariants** (owned by **WebGME**) from **per-state hook behavior files** (stored directly in **Git** via [`webgme-git`](https://github.com/kecso/webgme-git)).

## System Topology

```text
+-------------------------------------------------------------------+
|                     Rusty Studio UI (/routers/studio)             |
|                                                                   |
|  Left Explorer   |  Center Diagram + Crate | Right IDE & Simulator |
|  (Collapsible)   |  (ELK/Dag Fixed Layout) |  State Entry/Exit     |
|  - States        |  - Compact Badges A..Z  |  Transition Guard &   |
|  - Globals (Min/ |  - Edge Tooltips        |  Exclusivity + Action |
|    Max bounds)   |  - Impact Banner        |  Live Simulator       |
+--------+--------------------+-------------------------+-----------+
         | WebGME Client API  | Octokit (GitHub App)    | HTTP POST
         v                    v                         v
+-----------------+  +--------------------+   +---------------------+
| WebGME Server   |  | webgme-git         |   | RustSimRouter       |
| Core + MongoDB  |  | gitrouter          |   | /routers/rustsim    |
| (Nodes, Sets,   |  | Auto-fetch, commit |   | Temp Crate Sandbox  |
|  Guards, Deps)  |  | Auto-rebase / 409  |   | cargo check / test  |
+-----------------+  +--------------------+   +---------------------+
                              |
                              v
                  GitHub Repository (`dev` branch)
                  examples/<machine>/src/states/<state>.rs
```

## Responsibilities

| Component | Source of Truth | Path / Module |
| --- | --- | --- |
| **StateMachine, States, Transitions, Guards, Globals (with Min/Max bounds), Events, `dependsOn` Sets** | WebGME MongoDB Model | [`metamodel/Language.json`](https://github.com/kecso/rusty/blob/main/metamodel/Language.json) |
| **Pure Guard AST & Mutual-Exclusivity Prover (DNF + Rational FME + Integer B&B)** | Shared Common Module | [`src/common/rustGuardLang.js`](https://github.com/kecso/rusty/blob/main/src/common/rustGuardLang.js) |
| **Pure State Hook Modules (`on_enter`, `on_exit`, squashed `tr_<slug>`)** | GitHub Repo + `codeCache` mirror | `examples/<machine>/src/states/<state>.rs` |
| **Design-Impact + Hook Analyzer** | Browser Edit-Time Checker | [`src/common/rustAnalyzer.js`](https://github.com/kecso/rusty/blob/main/src/common/rustAnalyzer.js) |
| **Standalone Cargo Crate Codegen (`TransitionId`, `select_transition`, `execute_transition`)** | Shared + WebGME Plugin | [`src/common/rustCodegen.js`](https://github.com/kecso/rusty/blob/main/src/common/rustCodegen.js) |
| **GitHub Directory Importer** | Shared + WebGME Plugin | [`src/common/rustImporter.js`](https://github.com/kecso/rusty/blob/main/src/common/rustImporter.js) |
| **Dual-Deployment Server Modes** | WebGME Config & Studio Router | [`config/`](https://github.com/kecso/rusty/tree/main/config) & [`StudioRouter.js`](https://github.com/kecso/rusty/blob/main/src/routers/StudioRouter/StudioRouter.js) |

## Three-Layer Safety Net

| Layer | Where | Latency | What It Catches |
| --- | --- | --- | --- |
| **1. Guard & Exclusivity Prover** | `RustyGuardLang` (browser) | `< 1 ms` | Pure guard syntax/types + formal overlap proofs across sibling transitions on `(State, Event)` with concrete counterexamples |
| **2. Edit-Time & Impact Checks** | `RustyAnalyzer` (browser) | `< 1 ms` | Red/yellow Monaco squiggles on `globals.*`, `payload`, forbidden `StateId::`/`Event::`, delimiters, and stale `dependsOn` design impacts |
| **3. Native `rustc` + Trace Parity** | `RustSimRouter` (`cargo`) | `~1 s` | Full Rust borrow-checker, type inference, `debug_assert!` determinism checks, and bit-exact JS ↔ Rust runtime parity |
