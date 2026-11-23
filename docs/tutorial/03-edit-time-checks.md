# Tutorial 2: Guard Proofs, Edit-Time Checks & Design Impact

Rusty guarantees three continuous layers of safety in **Real-Time Browser Analysis** (`< 1 ms`) backed by real **`rustc`** diagnostics.

![Guard proofs, contextual read-only Monaco edit-time checks, and rustc verification](/images/demo-monaco-edit-checks.gif)

## Layer 1 — Pure Guard Syntax & Mutual-Exclusivity Proofs

Select **`Heating ↺ Heating` (`heat_step`)** in `SmartThermostat` and look at the **`Guard & Exclusivity`** tab:

1. **Pure Guard Typing**:
   - Guards accept `GlobalVar` names directly (`current_temp_c`, `cycle_ticks`), typed literals, numeric arithmetic (`+`, `-`, `*`), comparisons, and boolean logic (`&&`, `||`, `!`).
   - Try typing an assignment `current_temp_c = 25.0` → instant **`RUSTY_G002`** error (`Assignment '=' is not allowed in guards`).
   - Try comparing `cycle_ticks < 40.0` (`u32` vs `f64`) → instant **`RUSTY_E003`** type mismatch.
2. **Concrete Overlap Counterexample**:
   - Temporarily remove the upper guard clauses on `heat_step` so the guard becomes just `current_temp_c < target_temp_c + hysteresis_c`.
   - `RustyGuardLang` tests `heat_step` against sibling `Heating → Cooldown` (`current_temp_c >= 40.0 || cycle_ticks >= max_cycle_ticks`) using **DNF + exact BigInt Rational Fourier-Motzkin Elimination + Integer Branch-and-Bound**.
   - The **`Guard & Exclusivity`** box immediately turns red (**`✕ Non-Deterministic Guard Overlap!`**) and displays a verified concrete counterexample where both transitions would fire simultaneously!
   - Undo the edit to restore **`✓ Proven Mutually Exclusive`**.

## Layer 2 — Contextual Read-Only Monaco & Hook Checks

Open **`Action Hook`** on `heat_step` (or **`Entry`** on state **`Heating`**) to inspect `src/states/heating.rs`:

### Exercise 1: Verify Strictly Read-Only Surrounding Code

- Notice that lines outside `tr_heat_step` (`#![allow(unused_variables)]`, `use crate::types::Globals;`, `pub fn on_enter`, signatures, and sibling functions) are dimmed and locked.
- Clicking or trying to type/Backspace on a header or signature line is blocked cleanly with a toast reminder (`Surrounding state file lines are strictly read-only — edit only inside the active hook body`).

### Exercise 2: Catch Global Variable Typos (`RUSTY_E001`)

Inside `tr_heat_step`, change `globals.eco_mode` to `globals.eco_mde`:
- Instant squiggle appears under `eco_mde`:
  `[RUSTY_E001] Unknown global variable globals.eco_mde. Did you mean globals.eco_mode?`

### Exercise 3: Catch Numeric Domain Errors (`RUSTY_E003`) & `rustc`

Assign `-1` to `u32` field `globals.cycle_ticks`:

```rust
globals.cycle_ticks = -1;
```

- Instant `RustyAnalyzer` error flags the negative literal assignment to unsigned `u32`.
- Click **`✓ Verify with rustc`** — real `cargo check` underlines the exact line in `src/states/heating.rs`.

### Exercise 4: Catch Forbidden Control Flow & Invalid Payloads (`RUSTY_E040`, `RUSTY_E041`)

- Try writing `StateId::Cooldown` or `Event::Tick` inside any hook → instant **`RUSTY_E040`** (`Control-flow reference is forbidden inside hook code — transitions and events belong strictly to the design`).
- Try referencing `payload` inside `on_enter`, `on_exit`, or a unit-event transition (`Tick`) → instant **`RUSTY_E041`**.

## Layer 3 — Reactive Design-to-Code Impact (`dependsOn` Set)

When **design** elements change, Studio knows every hook and guard that depends on them:

1. In **Globals**, rename **`max_cycle_ticks`** to **`duty_limit`** (and save).
2. Immediately:
   - An amber **Design Impact Banner** lists every impacted **State** and **Transition** whose `dependsOn` Set references that `GlobalVar`.
   - Every impacted item shows a warning badge (`⚠ N`) in the explorer and Inspector until its guard (`cycle_ticks < max_cycle_ticks`) and code are updated or resolved.
3. Restore `max_cycle_ticks` to clear all impact warnings cleanly.

See [Reference: Edit-Time & Impact Diagnostics](../reference/diagnostics.md) for the complete diagnostic code catalog.
