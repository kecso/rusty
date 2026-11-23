# Tutorial 4: Standalone Rust Crates & How Design Maps to Code

**Generated machines are 100% standalone.** Every Rusty machine compiles into a standard, zero-dependency Cargo crate (`Cargo.toml`, `src/lib.rs`, `src/main.rs`, `src/types.rs`, `src/machine.rs`, and `src/states/*.rs`) that runs completely outside Rusty Studio and WebGME.

![Generated crate preview and one-time Connect Git Repository modal](/images/demo-generated-crate.gif)

## 1. How Your Visual Design Is Represented in Generated Rust

Rusty keeps visual structure and hand-authored behavior cleanly separated across generated vs. Git-synced files:

| File in Crate | Origin | What It Contains |
| --- | --- | --- |
| `Cargo.toml` | **Generated** from WebGME `StateMachine` | Package name (`crateName`), description, `[lib]` and `[[bin]]` targets — zero external crate dependencies |
| `src/types.rs` | **Generated** from WebGME nodes | **`StateId` enum** (all States), **`Event` enum + `Event::parse(&str)`** (all EventDefs + payload types), **`Outcome` enum**, and **`Globals` struct** (all GlobalVars + `Default` values) |
| `src/machine.rs` | **Generated** from WebGME topology | **`StateMachine` struct & `dispatch(&mut self, event)` engine**: calls state hooks (`on_exit` → transition → `on_enter`), chains `Outcome::Emit` events up to depth 8, and encodes every **WebGME `Transition` & `guard` expression** inside **`evaluate_model_transitions(&self, event)`** |
| `src/states/*.rs` | **Git-Backed** (`src/states/<state>.rs`) | Per-state `on_enter`, `on_event`, and `on_exit` behavior edited in Monaco or any external Rust IDE |
| `src/lib.rs` & `src/main.rs` | **Generated** | Crate root, unit smoke test, and JSON-lines CLI runner (`cargo run -- Start Tick ...`) |

Notice how **two levels of transition logic** work together seamlessly in `src/machine.rs`:
- State code in `src/states/<state>.rs` can explicitly return `Outcome::Transition(StateId::Next)`.
- Or a state can handle data updates and return `Outcome::Stay`, letting generated `evaluate_model_transitions()` evaluate your WebGME **`Transition` + `guard` rules** (e.g. `if self.current == StateId::Standby && matches!(event, Event::Tick) && (globals.current_temp_c < globals.target_temp_c - globals.hysteresis_c) { return Some(StateId::Heating); }`).

## 2. Inspect, Push, or Export Your Standalone Crate

- **Live Crate Tab**: Click **Crate** in Rusty Studio's center pane to inspect every generated file live or click **Download JSON Bundle**.
- **Commit Standalone Crate to Git**: Click **Push Full Crate** in the top bar to commit `Cargo.toml` + `src/**` directly under your machine's GitHub directory.
- **Stock WebGME Export (`GenerateRustCrate`)**: In dev mode (`http://127.0.0.1:8888/`), navigate into any `StateMachine` node and run **`Generate Rust Crate`** to export the standalone crate as a downloadable WebGME artifact.
- **Initial Import from GitHub (`ImportFromGitHub`)**: When creating a new machine in Rusty Studio, open **`Connect Git Repository…`** and select **Connect & import existing Rust code (one-time)** (or run `Import StateMachine from GitHub Directory` from WebGME in dev mode).

## 3. Running Generated Machines Independently with `cargo`

No WebGME server, MongoDB, or Node.js is needed to compile, test, embed, or run a generated crate:

```bash
# Test both standalone example crates directly with Cargo
(cd examples/blinky && cargo test)
(cd examples/smart-thermostat && cargo test)

# Run SmartThermostat as a standalone native CLI binary
cd examples/smart-thermostat
cargo run --quiet -- SetTarget:26.0 Tick Tick Tick ToggleEco Tick EmergencyShutoff Reset
```

`main.rs` outputs one structured JSON trace line per dispatched event:

```json
{"step":0,"event":"__init__","from":"Standby","to":"Standby","globals":{"current_temp_c":21,...}}
{"step":1,"event":"SetTarget:26.0","from":"Standby","to":"Standby","globals":{"current_temp_c":21,"target_temp_c":26,...}}
{"step":2,"event":"Tick","from":"Standby","to":"Heating","globals":{"current_temp_c":20.25,"target_temp_c":26,...}}
```

If you edit starter models in `src/common/rustContract.js`, regenerate both checked-in example crates with `npm run sync:examples`.
