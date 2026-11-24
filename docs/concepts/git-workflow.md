# Hybrid `webgme-git` Workspace & Git Sync Workflow

Rusty serves as the reference showcase for [`webgme-git`](https://github.com/kecso/webgme-git). WebGME models store **zero canonical Rust code** (only design topology, pure guards, `dependsOn` Sets, and **`GitArtifactLink`** metadata); all generated crate files and Rust hook modules live exclusively inside `webgme-git` hybrid workspaces and connected GitHub repositories.

## 1. The `GitArtifactLink` Mixin

Both `StateMachine` and `State` inherit attributes from the abstract `GitArtifactLink` meta-node:

| Attribute | Meaning on `StateMachine` | Meaning on `State` |
| --- | --- | --- |
| `gitOwner` | Repository owner (blank in local hybrid mode, or `<owner>` via **Connect Git Repository…**) | Inherited from machine |
| `gitRepo` | Repository name (or local slug `local/<crate>`) | Repository name |
| `gitBranch` | Target branch on push (default `main`; does not require matching WebGME branches) | Target branch |
| `gitPath` | Crate/states directory (e.g. `examples/smart-thermostat`) | Derived automatically as `<machine_dir>/src/states/<state>.rs` |
| `gitArtifactType` | `dir` | `file` |
| `gitBaseCommitSha` | Pinned commit SHA the overlay session compares against | Synchronized per commit |

## 2. Hybrid Session Staging, Validation & Explicit Push

1. **Workspace Hydration on Open**: When a `StateMachine` opens in Rusty Studio, `ensureMachineWorkspaceReady` reads its crate files from `webgme-git` (`GET /routers/gitrouter/workspace/tree` + `file`) into the active Studio session (and seeds initial files for the built-in local starter machines).
2. **Incremental Delta Staging (`PATCH /workspace`)**:
   - Editing Rust hooks in Monaco (`⌘S` / `Ctrl+S` or **Save Hook (⌘S)**) stages only the modified `src/states/<state>.rs` (plus `src/machine.rs` if a transition toggles between having and not having an `action` hook).
   - Design changes stage only their affected artifacts: adding/editing globals updates `src/types.rs` (and auto-refactored state/guard files on rename); editing events updates `src/types.rs` and `src/machine.rs`; adding/renaming/deleting states updates `src/states/mod.rs`, `src/machine.rs`, and the affected state `.rs` file(s); saving transition guards/metadata updates `src/machine.rs` and the source state `.rs` header.
   - Because changes accumulate inside the server-side `webgme-git` overlay rather than pushing on every keystroke, every design & code edit stays atomic and persistent across page reloads without flooding GitHub history.
3. **Whole-Crate Import & Bind**: Clicking **Connect Git Repository…** either binds an existing model and stages its full workspace onto the target repo's base commit SHA, or **Imports** a whole crate directory from GitHub via `POST /routers/gitrouter/sweep` without overwriting design invariants. (Single-state partial pulls have been removed to prevent model/code drift.)
4. **Two-Layer Pre-Push Gate & Force Override (`POST /workspace/commit`)**:
   - `RustyAnalyzer` runs instant browser checks while typing (`< 1 ms`), and the **Commit & Push** modal displays staged diffs alongside browser check results.
   - Server-side `RustSimRouter` registers a `rusty-cargo-check` validator on `webgme-git` (`registerValidator`), running `cargo check --offline` against the virtual workspace overlay before committing. If validation fails, `webgme-git` rejects the push with `HTTP 422`; clicking **Force Push Anyway** sends `force: true` to bypass both browser and server validation gates.
5. **Conflict Detection, Rebase & Portable ZIP Export**:
   - Before or during commit, if upstream moved on different files, `webgme-git` tree-rebases or offers **Rebase Base onto Latest Upstream**; same-file collisions return `HTTP 409` for the **3-Way Merge Conflict Resolver**.
   - At any time (including local hybrid mode without GitHub sign-in), clicking **↓ Download .zip** calls `POST /routers/gitrouter/workspace/archive` to download all machine crates packaged cleanly by repo path.
