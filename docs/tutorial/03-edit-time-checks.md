# Tutorial 3: Edit-Time Checks in Monaco

Rusty Studio embeds **Monaco Editor** (`0.57.0`) directly inside the state inspector and pairs it with **`RustyAnalyzer`** (`src/common/rustAnalyzer.js`) for **sub-millisecond edit-time verification** against your live WebGME model.

## Why Not Wait for `cargo check` on Every Keystroke?

Running `cargo check` spawns a subprocess (~300–1000ms) and only catches errors *after* regenerating the crate. By contrast, `RustyAnalyzer` inspects your live WebGME symbol tables (`GlobalVar`, `EventDef`, `State`, `Transition`) in **< 1 millisecond** in the browser on a 55ms keystroke debounce. You get:

1. **WebGME-Driven Autocomplete** when typing `globals.`, `Event::`, `StateId::`, or `Outcome::`
2. **Inline Red/Yellow Monaco Squiggles** as you type
3. **Clickable Problems List** below Monaco that jumps the cursor to the exact line and column
4. **Full `rustc` Overlay** when clicking **✓ Verify with rustc**, merging real compiler errors onto the same Monaco editor

## Hands-On Exercises (Try Breaking `Heating`!)

Select **`SmartThermostat`** → **`Heating`** in Rusty Studio and try each edit below inside Monaco (without saving yet!):

### Exercise 1: Catch a Misspelled Global Variable (`RUSTY_E001`)

Change `globals.eco_mode` to `globals.eco_mde`.

- Within ~55ms, Monaco underlines `eco_mde` in red:
  > `[RUSTY_E001] Unknown global variable globals.eco_mde. Did you mean globals.eco_mode?`

### Exercise 2: Catch Type & Sign Errors on Globals (`RUSTY_E002`, `RUSTY_E003`)

Add a line inside `on_enter`:

```rust
globals.cycle_ticks = -1;
globals.eco_mode += 1;
```

- `cycle_ticks` is `u32` (unsigned), so `-1` is flagged immediately as `RUSTY_E003`.
- `eco_mode` is `bool`, so `+=` is flagged immediately as `RUSTY_E002`.

### Exercise 3: Catch Payload Arity & Type Errors on Events (`RUSTY_E011`, `RUSTY_E012`)

Try returning:

```rust
Outcome::Emit(Event::SetTarget("warm"))
```

- `RustyAnalyzer` checks the WebGME `EventDef` node for `SetTarget` (`payloadType = f64`) and flags `"warm"` with `RUSTY_E012`.

### Exercise 4: Catch Unhandled Self-Emitted Events (`RUSTY_W013`)

Try returning `Outcome::Emit(Event::ToggleEco)` without matching `Event::ToggleEco` or declaring a WebGME transition for it on that state — `RustyAnalyzer` warns with `RUSTY_W013` so an emitted event never disappears silently.

### Exercise 5: Catch Undeclared Topology Transitions (`RUSTY_W021`)

Try returning `Outcome::Transition(StateId::Cooling)` from `Heating`.

- `StateId::Cooling` exists, so `E020` does not fire — instead `RUSTY_W021` warns that there is no matching WebGME `Transition` edge from `Heating` to `Cooling` on the diagram!
- Either fix the code or use **⇢ Add Transition** on the diagram to keep topology and code 100% consistent.

See [Reference: Edit-Time Diagnostics](../reference/diagnostics.md) for the complete list of codes.
