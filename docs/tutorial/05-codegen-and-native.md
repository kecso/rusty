# Tutorial 5: Codegen & Running Natively with Cargo

Everything you model in WebGME and edit in Monaco compiles into a standalone, zero-dependency Rust crate (`Cargo.toml`, `src/lib.rs`, `src/main.rs`, `src/types.rs`, `src/machine.rs`, `src/states/*.rs`).

![Generated Rust crate preview and Bind GitHub Repo modal](/images/demo-generated-crate.gif)

## 1. Inspect the Generated Crate in Studio

In Rusty Studio's center pane, click the **Generated Rust Crate** tab to browse every generated file live as you edit your WebGME model:

- `Cargo.toml` — package metadata & `[[bin]]` target
- `src/types.rs` — `StateId` enum, `Event` enum (with `Event::parse(&str)` CLI parser), `Outcome` enum (`Stay`, `Transition(StateId)`, `Emit(Event)`), and `Globals` struct (with `Default` and `to_json()`)
- `src/states/mod.rs` — module declarations for all `State` nodes
- `src/states/<state>.rs` — individual state behavior modules (synchronized with GitHub via `webgme-git`)
- `src/machine.rs` — deterministic `StateMachine::dispatch(&mut self, event: &Event)` loop (handles `Outcome::Emit` chaining up to depth 8, `on_exit`/`on_enter` lifecycle hooks, and fallback WebGME transition guards)
- `src/lib.rs` — library crate root + unit test
- `src/main.rs` — JSON-lines CLI trace runner

## 2. Export from Stock WebGME (`GenerateRustCrate` Plugin)

Because Rusty uses proper WebGME metamodeling:

1. Click **WebGME UI ↗** in the Studio top bar to open your live project in WebGME.
2. Navigate into a `StateMachine` node (`BlinkyController` or `SmartThermostat`).
3. Run the **`Generate Rust Crate`** plugin from the WebGME plugin menu — it executes `src/plugins/GenerateRustCrate/GenerateRustCrate.js` via `core` and saves the entire crate as a downloadable WebGME Blob artifact.

## 3. Run the Checked-In Example Crates Locally

Both tutorial models are materialized as ready-to-run Cargo crates under `examples/`:

```bash
# Run unit tests on both example crates
(cd examples/blinky && cargo test)
(cd examples/smart-thermostat && cargo test)

# Execute SmartThermostat from the CLI with unit + f64 payload events
cd examples/smart-thermostat
cargo run --quiet -- SetTarget:26.0 Tick Tick Tick ToggleEco Tick EmergencyShutoff Reset
```

`main.rs` emits one JSON object per step:

```json
{"step":0,"event":"__init__","from":"Standby","to":"Standby","globals":{"current_temp_c":21,...}}
{"step":1,"event":"SetTarget:26.0","from":"Standby","to":"Standby","globals":{"current_temp_c":21,"target_temp_c":26,...}}
{"step":2,"event":"Tick","from":"Standby","to":"Heating","globals":{"current_temp_c":20.25,"target_temp_c":26,...}}
```

If you modify `src/common/rustContract.js`, regenerate both checked-in crates with:

```bash
npm run sync:examples
```
