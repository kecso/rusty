# Reference: WebGME Metamodel (`metamodel/Language.json`)

Rusty's DSML is defined in `metamodel/Language.json` and compiled into `seed/RustySeed.webgmex` via `webgme-json-importer` (`npm run build:seed`).

## Meta Nodes

| Meta Type | Base / Mixin | Containment / Pointers | Attributes |
| --- | --- | --- | --- |
| **`GitArtifactLink`** *(abstract)* | `FCO` | Mixin source | `gitOwner`, `gitRepo`, `gitBranch`, `gitPath`, `gitArtifactType` (`file` \| `dir`), `gitBaseCommitSha` |
| **`StateMachine`** | `FCO` + `GitArtifactLink` | Contains `State`, `Transition`, `GlobalVar`, `EventDef` | `name`, `crateName`, `description`, `tickMs`, plus inherited `GitArtifactLink` (`gitArtifactType="dir"`) |
| **`State`** | `FCO` + `GitArtifactLink` | Child of `StateMachine` | `name`, `description`, `isInitial`, `isFinal`, `color`, `codeCache`, plus inherited `GitArtifactLink` (`gitArtifactType="file"`) |
| **`Transition`** | `FCO` | Child of `StateMachine`; `src -> State`, `dst -> State` (`1..1`) | `name`, `event`, `guard`, `action`, `priority` |
| **`GlobalVar`** | `FCO` | Child of `StateMachine` | `name`, `rustType` (`bool` \| `i32` \| `i64` \| `u32` \| `f64` \| `String`), `initialValue`, `description` |
| **`EventDef`** | `FCO` | Child of `StateMachine` | `name`, `payloadType` (empty for unit event, or Rust type e.g. `f64`), `description` |

## Rebuilding the Seed

```bash
# Rebuilds seed/RustySeed.webgmex completely in-memory (no MongoDB required)
npm run build:seed
```
