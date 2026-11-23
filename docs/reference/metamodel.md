# Reference: WebGME Metamodel (`Language.json`)

Rusty defines 6 meta-nodes in [`metamodel/Language.json`](https://github.com/kecso/rusty/blob/main/metamodel/Language.json) compiled into [`seed/RustySeed.webgmex`](https://github.com/kecso/rusty/blob/main/seed/RustySeed.webgmex).

## Meta-Nodes & Attributes

| Meta Node | Base / Mixin | Containment / Pointers / Sets | Attributes |
| --- | --- | --- | --- |
| **`GitArtifactLink`** *(abstract)* | `FCO` | Mixed into `StateMachine` and `State` | `gitOwner`, `gitRepo`, `gitBranch`, `gitPath`, `gitArtifactType` (`file` \| `dir`), `gitBaseCommitSha` |
| **`StateMachine`** | `FCO` + `GitArtifactLink` | Child of `ROOT`; contains `State`, `Transition`, `GlobalVar`, `EventDef` | `name`, `crateName`, `description`, `tickMs`, plus machine-level Git directory attributes (`gitArtifactType = "dir"`) |
| **`State`** | `FCO` + `GitArtifactLink` | Child of `StateMachine`; **`dependsOn`** Set → `{GlobalVar, EventDef, State}` | `name`, `description`, `isInitial`, `isFinal`, `color`, `entryCode`, `exitCode`, `codeCache`, **`depsSignature`** |
| **`Transition`** | `FCO` | Child of `StateMachine`; `src -> State`, `dst -> State` (`1..1`); **`dependsOn`** Set → `{GlobalVar, EventDef, State}` | `name`, `event`, `guard`, `action`, `reenter`, **`depsSignature`** |
| **`GlobalVar`** | `FCO` | Child of `StateMachine` | `name`, `rustType` (`bool` \| `i32` \| `i64` \| `u32` \| `f64` \| `String`), `initialValue`, `minValue`, `maxValue`, `description` |
| **`EventDef`** | `FCO` | Child of `StateMachine` | `name`, `payloadType` (empty for unit event, or Rust type e.g. `f64`), `description` |

## Computed `dependsOn` Set & Domain Bounds

- **`dependsOn` Set & `depsSignature`**: Whenever State hooks (`entryCode`, `exitCode`), Transition `guard`s, or Transition `action` (`tr_*`) hooks are saved, imported, or seeded, `RustyAnalyzer.extractDependencies` extracts every referenced `GlobalVar`, `EventDef`, and `State` node and persists them into the node's WebGME **`dependsOn`** Set along with a type/name fingerprint (`depsSignature`). When any element in the design changes or disappears, `computeDesignImpact` surfaces the affected states and transitions immediately.
- **Order-Independent Transitions**: Transitions do not carry precedence numbers; sibling guards on the same `(State, Event)` must be proven mutually exclusive.
- **Self-Transition `reenter`**: Controls whether a `src == dst` self-transition runs only its `tr_<slug>` action (`false`, default) or full `on_exit -> tr_<slug> -> on_enter` (`true`).
- **`GlobalVar` `minValue` / `maxValue`**: Optional numeric bounds fed into `RustyGuardLang` for stronger exclusivity proofs and emitted into `src/types.rs` as `// @rusty:bounds min="..." max="..."` comments for Git round-tripping.

## Rebuilding the Seed

```bash
# Rebuilds seed/RustySeed.webgmex completely in-memory (no MongoDB required)
npm run build:seed

# Synchronizes starter models -> examples/blinky & examples/smart-thermostat + Cargo.toml
npm run sync:examples
```
