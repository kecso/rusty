# Rust State & Transition Hook Contract

Every `State` in Rusty maps cleanly to one pure `#![no_std]`-friendly state module (`src/states/<state>.rs`) without ever importing `StateId` or `Event`. Control flow, transition dispatch, and guard evaluation live in generated `src/machine.rs`.

## Canonical State Module Structure (`src/states/<state>.rs`)

```rust
#![allow(unused_variables)]
//! State hooks for: Heating
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering Heating
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Heating");
}

/// Exit action when leaving Heating
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}

/// Transition: Heating --(Tick)--> Heating (stay)
/// Guard: current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c < target_temp_c + hysteresis_c
// @rusty:hook tr:tr_heat_step
pub fn tr_heat_step(globals: &mut Globals) {
    let power_c = if globals.eco_mode { 1.0 } else { 1.75 };
    let watts = if globals.eco_mode { 15.0 } else { 25.0 };
    let loss = (globals.current_temp_c - globals.ambient_temp_c) * 0.125;
    globals.current_temp_c = ((globals.current_temp_c + power_c - loss) * 100.0).round() / 100.0;
    globals.energy_wh = ((globals.energy_wh + watts) * 100.0).round() / 100.0;
    globals.cycle_ticks += 1;
}
```

## Contract Rules

- **Strict Control-Flow Isolation**: State modules import **only** `use crate::types::Globals;`. Referencing `StateId::*`, `Event::*`, or return-control enums inside any state or transition hook triggers an immediate **`RUSTY_E040`** error.
- **State Lifecycle Hooks (`on_enter`, `on_exit`)**:
  - `on_enter(globals: &mut Globals)` runs immediately on initial entry and whenever an external transition (or a self-transition with `reenter = true`) enters the state.
  - `on_exit(globals: &mut Globals)` runs before leaving the state (no `during` hook exists on states).
  - Neither `on_enter` nor `on_exit` receives an event `payload` (`RUSTY_E041` if referenced).
- **Squashed Transition Action Hooks (`tr_<slug>`)**:
  - Transitions with non-empty `action` bodies are emitted into the source state's `.rs` file with concise squashed function names such as `tr_heat_step` or `tr_set_target`, annotated with full `/// Transition:` / `/// Guard:` doc comments and `// @rusty:hook tr:<fnName>` markers.
  - If the trigger event declares a `payloadType` (for example `SetTarget` with `f64`), the signature automatically receives `payload: f64`.
- **Single-Hook Contextual Editing**:
  - In Rusty Studio, **State Inspector** (`Entry` | `Exit`) and **Transition Inspector** (`Action Hook`) display the complete composed `.rs` file so surrounding signatures and functions remain visible, while locking every line outside the active hook body as strictly read-only.

## Execution Equivalence (Live Simulator & Native `rustc`)

Both the browser-side `RustySimEngine` and the generated `src/machine.rs` execute the exact same pure lifecycle:

1. Match `(self.current, event)` and evaluate pure guard expressions in `select_transition`.
2. Verify determinism (`debug_assert!` in Rust, formal prover at edit time).
3. Run `exit -> tr_* -> enter` for external transitions (or self-transitions with `reenter = true`), and `tr_*` alone for self-transitions with `reenter = false`.

- Mutable fields match **`Globals`** (`globals.blink_count`, `globals.current_temp_c`, etc.)
- Arithmetic (`+`, `-`, `*`, `/`, `+=`, `-=`, `*=`, `/=`), `.clamp(min, max)`, `.round()`, `if / else`, and `String::from("...")` are supported identically in both the browser simulator and native Cargo builds.
