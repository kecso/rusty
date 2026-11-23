# Reference: WebGME Metamodel (`metamodel/Language.json`)

Rusty's DSML is defined in `metamodel/Language.json` and compiled into `seed/RustySeed.webgmex` via `webgme-json-importer` (`npm run build:seed`).

## Meta Nodes & Relationships

| Meta Type | Base / Mixin | Containment / Pointers / Sets | Attributes |
| --- | --- | --- | --- |
| **`GitArtifactLink`** *(abstract)* | `FCO` | Mixin source | `gitOwner`, `gitRepo`, `gitBranch`, `gitPath`, `gitArtifactType` (`file` \| `dir`), `gitBaseCommitSha` |
| **`StateMachine`** | `FCO` + `GitArtifactLink` | Contains `State`, `Transition`, `GlobalVar`, `EventDef` | `name`, `crateName`, `description`, `tickMs`, plus inherited machine-level `GitArtifactLink` (`gitArtifactType="dir"`) |
| **`State`** | `FCO` + `GitArtifactLink` | Child of `StateMachine`; **`dependsOn`** Set → `{GlobalVar, EventDef, State}` | `name`, `description`, `isInitial`, `isFinal`, `color`, `codeCache`, **`depsSignature`**, plus optional per-state `GitArtifactLink` overrides |
| **`Transition`** | `FCO` | Child of `StateMachine`; `src -> State`, `dst -> State` (`1..1`); **`dependsOn`** Set → `{GlobalVar, EventDef, State}` | `name`, `event`, `guard`, `action`, `priority`, **`depsSignature`** |
| **`GlobalVar`** | `FCO` | Child of `StateMachine` | `name`, `rustType` (`bool` \| `i32` \| `i64` \| `u32` \| `f64` \| `String`), `initialValue`, `description` |
| **`EventDef`** | `FCO` | Child of `StateMachine` | `name`, `payloadType` (empty for unit event, or Rust type e.g. `f64`), `description` |

## Computed `dependsOn` Set Relationship

Whenever state code or transition guards are saved/imported/seeded, `RustyAnalyzer.extractDependencies` extracts every referenced `GlobalVar`, `EventDef`, and `State` node and persists them into the node's WebGME **`dependsOn`** Set along with a type/name fingerprint (`depsSignature`). When any element in the design changes or disappears, `computeDesignImpact` surfaces the affected states and transitions immediately.

## Rebuilding the Seed

```bash
# Rebuilds seed/RustySeed.webgmex completely in-memory (no MongoDB required)
npm run build:seed
```
