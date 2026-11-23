# Demo Showcase: SmartThermostat (Full Reference)

**`SmartThermostat`** (`examples/smart-thermostat/`) is a complete pre-built demo model showcasing floating-point physics, payload events, guarded transitions, self-emitted alerts, and native Rust parity.

![SmartThermostat showcase in fixed layered layout with native parity](/images/demo-smart-thermostat.gif)

::: tip Want to build your own machine step by step?
Start with [Tutorial 1: Build a Simple Counter](./00-build-a-counter.md) to walk through creating states, globals, events, and guards from scratch.
:::

## What `SmartThermostat` Demonstrates

- **Rich `Globals` types**: `f64` (`current_temp_c`, `target_temp_c`, `hysteresis_c`, `ambient_temp_c`, `energy_wh`), `u32` (`cycle_ticks`, `max_cycle_ticks`), `i32` (`fault_code`), `bool` (`eco_mode`), and `String` (`status_note`).
- **Payload Events**: `Event::SetTarget(f64)` and `Event::SetAmbient(f64)` with `f64::clamp(...)`.
- **Actual Computation**: thermal drift `(ambient - current) * 0.125`, active power & Watt-hour integration (`energy_wh`), `if/else` expression switching, and `.round()` formatting.
- **Self-Emitted Events**: `Outcome::Emit(Event::OverheatAlert)` raised internally by `Heating` or `Cooling` when `cycle_ticks >= max_cycle_ticks` (or `current_temp_c >= 40.0`).
- **Safety State Machine Patterns**: mandatory 3-tick `Cooldown` rest state and latched `SafeLockout` requiring `Reset`.

## State Topology

```
                     Tick [temp < target - hyst]
               ┌──────────────────────────────────▶ ┌─────────┐
               │                                    │ Heating │──┐
          ┌────┴────┐   Tick [temp >= target+hyst]  └─────────┘  │ OverheatAlert
          │ Standby │ ◀──────────────────────────────┘    │      │ (self-emitted)
          │ (INIT)  │                                     │      ▼
          └────┬────┘                                     │  ┌──────────┐
               │   Tick [temp > target + hyst]            │  │ Cooldown │
               ├──────────────────────────────────▶ ┌─────────┐  └────┬─────┘
               │                                    │ Cooling │───────┘
               │                                    └─────────┘   Tick [cycle_ticks == 0]
               │                                         ▲             │
               │ EmergencyShutoff / overtemp             └─────────────┴──▶ Standby
               ▼
         ┌─────────────┐   Reset
         │ SafeLockout │ ──────────▶ Standby
         └─────────────┘
```

## Step 1: Switch to `SmartThermostat`

1. In Rusty Studio's top bar, change the **Machine** dropdown from `BlinkyController` to **`SmartThermostat`**.
2. Notice the **Git Repository** bar updates to `dir: examples/smart-thermostat` (states inherit `<dir>/src/states/<state>.rs`), ready for you to bind `<your-username>/rusty@dev` via **Bind GitHub Repo…**.
3. Hover any transition badge (`B ⚑`, `F`, `G`) on the **Diagram** to inspect its full Event + `[Guard]` tooltip, then switch the right pane to **Simulator**. Initial state is **`Standby`** with:
   - `current_temp_c = 21`
   - `target_temp_c = 22`
   - `hysteresis_c = 1`
   - `ambient_temp_c = 15` (chilly outside!)

## Step 2: Observe Passive Drift & Automatic Heating

1. Click **`⏭ Step Tick`**.
   - `Standby` computes passive heat loss: `(15 - 21) * 0.125 = -0.75`, so `current_temp_c` drops to **`20.25`**.
   - Since `20.25 < 22.0 - 1.0`, `Standby` transitions to **`Heating`**!
2. Click **`⏭ Step Tick`** three times in `Heating`:
   - Each tick adds `power_c = 1.75` minus ambient heat loss (`(current - ambient) * 0.125`), integrates `+25 Wh` into `energy_wh` (`25 -> 50 -> 75 Wh`), and increments `cycle_ticks`.
   - On the 3rd heating tick (`23.14°C >= 23.0°C`), `Heating` returns to **`Standby`**.

## Step 3: Inject Payload Events & Eco Mode

1. Click **`SetTarget(f64)`** and enter `28` (raises setpoint to `28°C`).
2. Click **`ToggleEco`** to set `eco_mode = true` and widen `hysteresis_c` to `1.5°C`.
3. Step **`Tick`** into `Heating`: notice each tick now draws **`15 Wh`** instead of `25 Wh` and heats at `+1.0°C` per tick.

## Step 4: Trigger Self-Emitted `Outcome::Emit(Event::OverheatAlert)`

Look at `examples/smart-thermostat/src/states/heating.rs`:

```rust
if globals.current_temp_c >= 40.0 || globals.cycle_ticks >= globals.max_cycle_ticks {
    globals.fault_code = 201;
    Outcome::Emit(Event::OverheatAlert)
}
```

1. In **Live Globals**, click `max_cycle_ticks` and set it to `3` (or keep ticking with `SetTarget(32)`).
2. On the 3rd tick in `Heating`, `Heating` emits `Event::OverheatAlert` internally!
3. The execution trace logs `emitted Event::OverheatAlert` and transitions straight into **`Cooldown`** with `cycle_ticks = 3`.
4. Step **`Tick`** 3 times to watch `Cooldown` count down (`3 -> 2 -> 1 -> Standby`) and clear `fault_code = 0`.

## Step 5: Test `Cooling`, `EmergencyShutoff`, and Native Parity

1. Click **`SetAmbient(f64)`** → `36`, then **`SetTarget(f64)`** → `20`, and click **`▶ Auto-Tick`** to watch `Standby` drift upward and enter **`Cooling`**.
2. Click **`EmergencyShutoff`** at any time to verify immediate transition to **`SafeLockout`** (`fault_code = 999`, `status_note = "LOCKED OUT - Reset required"`), then click **`Reset`**.
3. Click **`⚙ Verify in Native Rust`** — `/routers/rustsim/run` compiles `SmartThermostat` with `cargo` and confirms the native Rust binary produces the exact same final state and floating-point values!

## Step 6: Modify Computation Live in Monaco

1. Select **`Heating`** and switch the right pane back to **Inspector & Rust**.
2. In Monaco, change normal heating wattage from `25.0` to `30.0`:
   ```rust
   let watts = if globals.eco_mode { 15.0 } else { 30.0 };
   ```
3. Click **Save Draft to WebGME** (or press **`⌘S`** to commit & push to your fork's `dev` branch after binding `<your-username>/rusty` in [Tutorial 3](./04-github-sync-dev.md)), then click **✓ Verify with rustc** and re-run the **Simulator** to see `energy_wh` increase by `30 Wh` per tick!
