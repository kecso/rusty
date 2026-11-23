# Tutorial 4: Generated Standalone Crate & Native Rust Verification

Every WebGME `StateMachine` exports as a **self-contained, dependency-free Cargo crate** with `rustc` and runtime trace parity built in.

![Generated crate preview and one-time Connect Git Repository modal](/images/demo-generated-crate.gif)

## 1. Anatomy of the Generated Cargo Crate

Open the **`Crate`** tab in Rusty Studio to inspect every generated file live:

| File | Source | Contents |
| --- | --- | --- |
| `Cargo.toml` | **Generated** from `StateMachine.crateName` | Package manifest declaring both library (`src/lib.rs`) and CLI runner binary (`src/main.rs`) |
| `src/types.rs` | **Generated** from WebGME nodes | **`StateId` enum** (all States), **`Event` enum + `Event::parse(&str)`** (all EventDefs + payload types), and **`Globals` struct** (with default values and `// @rusty:bounds min="..." max="..."` annotations) |
| `src/machine.rs` | **Generated** from WebGME topology | **`TransitionId` enum**, **`select_transition(&self, event)`** (pure compiled guards + `@rusty:tr` metadata + `debug_assert!` overlap guard), **`execute_transition(&mut self, tid, event)`** (`on_exit -> tr_* -> on_enter`, or `tr_*` only on `!reenter` self-loops), and **`dispatch(&mut self, event)`** |
| `src/states/*.rs` | **Git-Backed** (`src/states/<state>.rs`) | Pure `on_enter`, `on_exit`, and squashed `tr_<slug>` hook functions—importing **only** `use crate::types::Globals;` |
| `src/states/mod.rs` | **Generated** | Declares `pub mod <state>;` for every `State` node |
| `src/lib.rs` / `src/main.rs` | **Generated** | Re-exports `StateMachine`, `TransitionId`, `StateId`, `Event`, `Globals`, unit smoke test (`initializes_in_valid_state`), and NDJSON CLI event runner |

## 2. How Model-Driven Codegen Works

In generated `src/machine.rs`, every design rule translates directly into deterministic Rust without external engine dependencies or runtime reflection:

- **`select_transition(&self, event)`**: Matches `(self.current, event)`, evaluates each candidate transition's pure compiled guard expression (for example `globals.current_temp_c < 40.0 && globals.cycle_ticks < globals.max_cycle_ticks && globals.current_temp_c < globals.target_temp_c + globals.hysteresis_c`), asserts no two guards overlap (`debug_assert!(matched.is_none(), ...)`), and returns `Option<TransitionId>`.
- **`execute_transition(&mut self, tid, event)`**:
  - For external transitions (`src != dst`) and `reenter == true` self-transitions: calls `self.exit_current()`, invokes `states::<src>::tr_<slug>(&mut self.globals [, *payload])` if non-empty, updates `self.current`, and calls `self.enter_current()`.
  - For standard `reenter == false` self-transitions (`src == dst`): skips `on_exit` / `on_enter` and invokes only `states::<src>::tr_<slug>(&mut self.globals [, *payload])`.

## 3. Running & Testing Natively on the CLI

Because the example directories inside this repository are complete crates generated directly by `rusty`, you can compile and run them offline outside the web browser at any time:

```bash
# Run BlinkyController step-by-step via CLI NDJSON runner
cargo run --manifest-path examples/blinky/Cargo.toml -- Start Tick Tick Tick

# Run SmartThermostat with typed f64 SetTarget payload and Eco toggle
cargo run --manifest-path examples/smart-thermostat/Cargo.toml -- Tick Tick SetTarget:25.0 ToggleEco Tick

# Execute unit smoke tests across both generated crates
cargo test --manifest-path examples/blinky/Cargo.toml
cargo test --manifest-path examples/smart-thermostat/Cargo.toml
```

In Studio, clicking **`↑ Push Full Crate`** commits all generated Cargo files alongside your Git-backed `src/states/*.rs` modules directly to your fork's `dev` branch, and clicking **`⚙ Verify in Native Rust`** compiles your live workspace in `/routers/rustsim` to confirm bit-exact JS ↔ Rust trace parity.
