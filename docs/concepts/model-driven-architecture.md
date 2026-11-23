# Model-Driven Control Flow & Mutual-Exclusivity Proofs

Rusty separates **design-owned control flow** from **state and transition hook behavior**. All topology, guards, and lifecycle sequencing are driven deterministically by the WebGME model rather than ad-hoc Rust code inside states.

## 1. Pure Classic State Machine Semantics

In Rusty:

- **States have only `Entry` (`on_enter`) and `Exit` (`on_exit`) hooks.** There is no per-state `during` hook and no per-state event-dispatch function.
- **No global / machine-wide event handlers.** Every event reaction—including periodic steps on `Tick` or parameter updates like `SetTarget(f64)`—is modeled explicitly as a `Transition` edge on the states where that event is accepted. If a state omits a transition for an event (for example, `SafeLockout` does not accept `SetTarget`), that event is cleanly ignored in that state.
- **External Transitions (`src -> dst`, where `src != dst`)** execute sequentially inside generated `src/machine.rs`:
  1. `src::on_exit(&mut globals)`
  2. `src::tr_<slug>(&mut globals [, payload])` *(transition action hook, if non-empty)*
  3. `self.current = StateId::Dst`
  4. `dst::on_enter(&mut globals)`
- **Self-Transitions (`src -> src`)** support two explicit modes via the `reenter` flag:
  - **`reenter = false` (default / internal reaction)**: Stays in state and runs **only `tr_<slug>`** without firing `on_exit` or `on_enter`. Ideal for periodic physics updates (`heat_step`, `cool_step`, `drift`) or payload updates (`set_target`).
  - **`reenter = true` (external self-transition)**: Fires `on_exit` → `tr_<slug>` → `on_enter`.

## 2. Single-File-Per-State Layout & Contextual Read-Only Monaco

Each `State` corresponds to one Git-backed file `<machine_dir>/src/states/<state>.rs` (while `Cargo.toml`, `src/types.rs`, `src/machine.rs`, `src/states/mod.rs`, `src/lib.rs`, and `src/main.rs` are generated directly from WebGME):

- **No control-flow imports inside state files**: `src/states/<state>.rs` imports only `use crate::types::Globals;` and can never import or return `StateId` or `Event::*` (`RUSTY_E040` flags any attempt immediately).
- **Squashed transition function names (`tr_<slug>`)**: Every transition belonging to a state whose `action` is non-empty gets a concise `pub fn tr_<slug>(globals: &mut Globals [, payload: T])` hook directly below `on_enter` and `on_exit`, prefixed with human-readable `/// Transition:` / `/// Guard:` doc comments and a `// @rusty:hook ...` marker.
- **Contextual Read-Only Monaco Editors**:
  - Selecting a **State** lets you switch between **Entry** (`on_enter`), **Exit** (`on_exit`), and **Transitions** tabs.
  - Selecting a **Transition** lets you switch between **Guard & Exclusivity** and **Action Hook** (`tr_<slug>`).
  - Both code editors display the **complete composed `src/states/<state>.rs` file** scrolled to the exact hook body so you always see surrounding functions and signatures, while every header, doc comment, signature, and sibling function outside your active hook is **dimmed and strictly read-only**.

## 3. Pure Guard Expression Language

Transition guards are written in a pure, side-effect-free subset of Rust expressions (`src/common/rustGuardLang.js`) validated in real time and compiled directly into `src/machine.rs` (`select_transition`):

| Feature | Allowed Syntax & Examples |
| --- | --- |
| **Identifiers** | Unqualified `GlobalVar` names (e.g. `current_temp_c`, `cycle_ticks`), qualified `globals.current_temp_c`, or event `payload` (when the trigger event carries a payload) |
| **Literals** | Booleans (`true`, `false`), integers (`0`, `-5`, `42`), floats (`40.0`, `21.5`), strings (`"ready"`) |
| **Arithmetic** | Binary `+`, `-`, `*`, unary `-` on numeric terms of matching Rust integer/float categories |
| **Comparisons** | `==`, `!=` (`bool`, numbers, `String`); `<`, `<=`, `>`, `>=` (numbers) |
| **Boolean Combinators** | `&&`, `\|\|`, `!`, and parentheses `(...)` |

Forbidden constructs—assignments (`=`, `+=`), enum paths (`::`), braces (`{}`), semicolons, indexing, and arbitrary calls—are rejected immediately (`RUSTY_G002`) so guards remain purely declarative and mathematically analyzable.

## 4. Formal Mutual-Exclusivity Proofs (Zero Ambiguous Ordering)

Rusty eliminates silent transition ordering rules. Whenever a `State` has multiple outgoing `Transition`s on the same trigger `Event`, the machine must be **formally deterministic**—their guards must be **mutually exclusive**.

`RustyGuardLang` (`checkPairExclusivity` / `checkMachineDeterminism`) automatically analyzes every sibling pair $(G_A, G_B)$ on the same `(State, Event)`:

1. **Disjunctive Normal Form (DNF) & De Morgan Expansion**: Negations `!` are pushed inward to atomic literals; `G_A && G_B` is expanded into conjunctive cubes tested independently.
2. **Domain Tightening from `GlobalVar` Bounds**: Integer types (`u32 >= 0`, etc.) plus optional `minValue` / `maxValue` metadata defined on `GlobalVar` nodes (`// @rusty:bounds min="..." max="..."` in `src/types.rs`) are added automatically (e.g. `hysteresis_c >= 0.0`).
3. **Boolean, String & Linear Arithmetic Solvers**:
   - **Boolean** variables check assignment consistency.
   - **String** comparisons (`==`, `!=`) use union-find equivalence classes.
   - **Numeric** constraints use **exact `BigInt` Rational Fourier-Motzkin Elimination (FME)** for real/float (`f64`) constraints and **integer tightening + branch-and-bound** for integer (`i32`, `i64`, `u32`) constraints—zero floating-point drift.
4. **Self-Certified Counterexamples**: If an overlap exists, Studio generates and verifies a concrete counterexample (for example, `current_temp_c = 40.0, target_temp_c = 50.0, hysteresis_c = 0.0`) inside the **Guard & Exclusivity** panel and Design Impact banner so you can see the exact condition where two transitions collide.

Generated `src/machine.rs` also emits `debug_assert!(matched.is_none(), ...)` inside `select_transition` as a runtime safety backstop during `cargo test`.
