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

1. **Workspace Hydration on Open (`WorkspaceSession`)**: Rusty Studio loads the shared `webgme-git` client SDK (`/routers/gitrouter/client/workspaceClient.js`) and opens a serialized `WorkspaceSession` per machine. Opening a `StateMachine` calls `session.load(...)` (backed by `GET /workspace/tree` + `file`) and seeds initial files for built-in local starter machines when empty.
2. **Incremental Delta Staging (`PATCH /workspace/ops`)**:
   - Editing Rust hooks in Monaco (`⌘S` / `Ctrl+S` or **Save Hook (⌘S)**) stages only the modified `src/states/<state>.rs` (plus `src/machine.rs` if a transition toggles between having and not having an `action` hook).
   - Design changes stage only their affected artifacts: adding/editing globals updates `src/types.rs` (and auto-refactored state/guard files on rename); editing events updates `src/types.rs` and `src/machine.rs`; adding/renaming/deleting states updates `src/states/mod.rs`, `src/machine.rs`, and the affected state `.rs` file(s); saving transition guards/metadata updates `src/machine.rs` and the source state `.rs` header.
   - Because changes accumulate inside the server-side `webgme-git` overlay rather than pushing on every keystroke, every design & code edit stays atomic and persistent across page reloads without flooding GitHub history.
3. **Whole-Crate Import & Bind**: Clicking **Connect Git Repository…** either binds an existing model and stages its full workspace onto the target repo's base commit SHA, or **Imports** a whole crate directory from GitHub via `WorkspaceClient.sweepDirectoryFiles(...)` without storing code in WebGME. (Single-state partial pulls have been removed to prevent model/code drift.)
4. **Two-Layer Pre-Push Gate & Force Override (`POST /workspace/commit`)**:
   - `RustyAnalyzer` runs instant browser checks while typing (`< 1 ms`), and the **Commit & Push** modal displays staged diffs alongside browser check results.
   - Server-side `RustSimRouter` registers a `rusty-cargo-check` validator on `webgme-git` (`registerValidator`), running `cargo check --offline` against the virtual workspace overlay before committing. If validation fails, `webgme-git` rejects the push with `HTTP 422`; clicking **Force Push Anyway** sends `force: true` to bypass both browser and server validation gates.
5. **External Git Drift Inspection, Advance Pin & Conflict Merge**:
   - When external commits advance GitHub ahead of the pinned `gitBaseCommitSha`, `GET /workspace/status?checkRemote=true` returns `syncState: "behind" | "diverged"` and `upstreamChanges` (`added`, `modified`, `removed`, `renamed`, `overlappingWithOverlay`).
   - Inside **Commit & Push**, Rusty Studio displays every externally modified crate file and offers **↓ Accept Upstream & Advance Pin**, which calls `session.rebaseBase({ reload: true })`, updates `gitBaseCommitSha` on the machine and its states, and re-indexes `dependsOn` + `depsSignature` across reloaded `.rs` hooks.
   - During push, if upstream moved on different files, `webgme-git` tree-rebases transparently; same-file line collisions return `HTTP 409` for the **3-Way Merge Conflict Resolver**.
6. **Portable ZIP Export**:
   - At any time (including local hybrid mode without GitHub sign-in), clicking **↓ Download .zip** calls `POST /routers/gitrouter/workspace/archive` to download all machine crates packaged cleanly by repo path.
