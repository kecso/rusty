# The Rust State Contract

Every `State` node in WebGME maps 1-to-1 to a Rust module under `src/states/<snake_name>.rs`. Because every state follows one tiny, `#![no_std]`-friendly contract, generated machines compose cleanly without macros or dynamic dispatch.

## Module Signature

Every state file imports generated types from `crate::types` and exposes three functions:

```rust
use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    // Runs once whenever the machine transitions INTO this state
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    // Runs on every dispatched Event while this state is active
    match event {
        Event::Tick => Outcome::Stay,
        _ => Outcome::Stay,
    }
}

pub fn on_exit(globals: &mut Globals) {
    // Runs once whenever the machine transitions OUT OF this state
}
```

## Generated Shared Types (`src/types.rs`)

`src/common/rustCodegen.js` synthesizes `src/types.rs` directly from your WebGME model:

- **`StateId`**: An enum with one PascalCase variant per `State` child node (e.g., `StateId::Standby`, `StateId::Heating`).
- **`Event`**: An enum generated from every `EventDef` node. Events with an empty `payloadType` generate unit variants (`Event::Tick`); events with a `payloadType` generate tuple variants (`Event::SetTarget(f64)`).
- **`Globals`**: A struct whose fields come from `GlobalVar` nodes (`bool`, `i32`, `i64`, `u32`, `f64`, `String`), initialized from each node's `initialValue`.
- **`Outcome`**: Controls what happens after `on_event` returns:

| Variant | Dispatcher Behavior |
| --- | --- |
| `Outcome::Stay` | Stays in the current state unless a fallback WebGME `Transition` guard matches |
| `Outcome::Transition(StateId::Target)` | Runs `on_exit()` on the old state, switches `current = Target`, and runs `on_enter()` on the new state |
| `Outcome::Emit(Event::SomeEvent)` | Re-dispatches `Event::SomeEvent` immediately within the same step (up to depth 8), allowing a state to raise internal alerts cleanly |

## Supported Expression Features in the Dynamic Browser Simulator

`RustySimEngine` interprets the exact same Rust contract in the browser, including:

- Assignments and compound arithmetic (`=`, `+=`, `-=`, `*=`, `/=`) on `globals.<field>`
- Local `let` / `let mut` bindings (with optional type annotations)
- `if` / `else if` / `else` statements and value-returning `if cond { a } else { b }` expressions
- `match event { ... }` with payload destructuring (`Event::SetTarget(t)` or `Event::SetTarget(&t)`), pattern alternatives (`A | B`), and match guards (`Event::Tick if ...`)
- Numeric & clamp helpers commonly used in control logic: `.round()`, `.abs()`, `.floor()`, `.ceil()`, `.clamp(lo, hi)`, `.min(b)`, `.max(b)`
- `String::from("...")` and `Outcome::{Stay, Transition, Emit}`
