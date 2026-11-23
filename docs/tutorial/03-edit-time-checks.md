# Tutorial 2: Edit-Time Checks, Guards & Design Impact Tracking

Rusty Studio pairs embedded **Monaco Editor** (`0.57.0`) with **`RustyAnalyzer`** (`src/common/rustAnalyzer.js`) and WebGME **`dependsOn` Set tracking** so mistakes are caught immediately—whether you are editing Rust code or reshaping the machine design.

![Design impact tracking, Monaco edit-time checks, and rustc verification](/images/demo-monaco-edit-checks.gif)

## Continuous Two-Way Protection

1. **Code → Design Checks (as you type in `< 1 ms`)**:
   - Autocomplete and inline red/yellow squiggles for shared variables, event payloads, transition targets, and transition guard expressions.
   - Clickable **Problems** list below Monaco + full **`✓ Verify with rustc`** overlay.
2. **Design → Code Impact Tracking (`dependsOn` WebGME Set)**:
   - Every State and Transition records which `GlobalVar`, `EventDef`, and `State` elements its Rust code or guard references (`dependsOn` Set + `depsSignature`).
   - Whenever you **rename**, **retype**, or **delete** an element in the left Explorer, Rusty immediately flags every affected state and transition in the **⚠ Design Impact Banner**, on the diagram nodes/badges, and inside the Inspector so nothing silently breaks until integration testing.

## Hands-On Exercises (`SmartThermostat`)

Select **`SmartThermostat`** → **`Heating`** in Rusty Studio and try the exercises below:

### Exercise 1: Trigger Live Design-to-Code Impact (`dependsOn` Set)

1. In the left **Globals** list, click **`✎`** on **`max_cycle_ticks`**.
2. Rename it to **`duty_limit`** and click **Apply to Design**.
3. Immediately observe:
   - The **⚠ Design Impact** banner appears above the diagram with clickable chips for **`Heating`**, **`Cooling`**, and any affected guards.
   - Both diagram boxes light up with `⚠` badges and sidebar warnings.
   - Changing a global's type (e.g., `eco_mode` from `bool` to `i32`) flags a `DESIGN_TYPE_CHANGED` review alert even before running `cargo`.
4. Click **`✎`** on `duty_limit` and restore **`max_cycle_ticks`**—all impact warnings clear immediately.

### Exercise 2: Validate Transition Guards Live

1. Click any guarded transition badge on the diagram (such as **`B ⚑`** from `Standby → Heating`).
2. In the right **Transition Inspector**, edit **Rust Guard Expression** to introduce a typo (`globals.target_tem_c`) or mismatched sign (`globals.cycle_ticks == -1`).
3. Live guard diagnostics appear immediately below the input with typo hints (`RUSTY_E001` / `RUSTY_E003`), and saving updates the Transition's `dependsOn` Set automatically.

### Exercise 3: Catch Misspelled Globals & Type Errors in Monaco

In **`Heating`**, temporarily change `globals.eco_mode` to `globals.eco_mde` and add `globals.cycle_ticks = -1;`:

- Within ~55ms, Monaco highlights both with red squiggles and lists `RUSTY_E001` and `RUSTY_E003` in the clickable **Problems** list.

### Exercise 4: Catch Payload & Topology Mismatches (`RUSTY_E012`, `RUSTY_W013`, `RUSTY_W021`)

- Returning `Outcome::Emit(Event::SetTarget("warm"))` flags payload type mismatch (`RUSTY_E012`).
- Emitting `Event::ToggleEco` without handling it warns `RUSTY_W013`.
- Returning `Outcome::Transition(StateId::Cooling)` from `Heating` warns `RUSTY_W021` because no matching edge exists on the diagram.

### Exercise 5: Verify with Real `rustc`

Click **`✓ Verify with rustc`** in the top bar—Studio compiles the complete generated crate on the server and overlays genuine `cargo check` compiler markers directly in Monaco.

See [Reference: Edit-Time & Impact Diagnostics](../reference/diagnostics.md) for every diagnostic code.
