# Showcase: `SmartThermostat` (HVAC Controller)

**`SmartThermostat`** (`examples/smart-thermostat/`) is a rich 5-state pre-seeded example in `RustySeed.webgmex` illustrating pure `Entry` / `Exit` hooks, non-reentrant self-transition physics actions (`tr_heat_step`, `tr_cool_step`, `tr_drift`), explicit per-state event acceptance, **`f64` payload events**, bounded `GlobalVar` domains, and **formally proven mutually exclusive guards** across **26 transitions**.

![SmartThermostat showcase in fixed layered layout with native parity](/images/demo-smart-thermostat.gif)

::: tip Want to build step by step first?
Start with [Tutorial 1: Build a Simple Counter](./00-build-a-counter.md) to walk through creating states, globals, events, and guards from scratch.
:::

## Architecture at a Glance

- **5 States**: `Standby` *(initial)*, `Heating`, `Cooling`, `Cooldown`, `SafeLockout`.
- **10 Typed Globals** *(many with `minValue`/`maxValue` domain bounds)*:
  `current_temp_c: f64` (`21.0`), `target_temp_c: f64` (`22.0`, bounds `10.0..32.0`), `hysteresis_c: f64` (`1.0`, bounds `0.0..5.0`), `ambient_temp_c: f64` (`15.0`, bounds `-20.0..50.0`), `energy_wh: f64` (`0.0`, min `0.0`), `cycle_ticks: u32` (`0`), `max_cycle_ticks: u32` (`10`, min `1`), `fault_code: i32` (`0`), `eco_mode: bool` (`false`), `status_note: String`.
- **6 Events (Unit + `f64` Payload)**: `Tick`, `SetTarget(f64)`, `SetAmbient(f64)`, `ToggleEco`, `EmergencyShutoff`, `Reset`.
- **No Global Event Handlers**: Notice how `SetTarget`, `SetAmbient`, and `ToggleEco` are explicitly connected as self-transitions (`reenter = false`) on `Standby`, `Heating`, and `Cooling`—and omitted from `SafeLockout` so configuration commands cannot alter a locked-out controller.

```text
                       Tick [current_temp_c >= 45.0]
               +-------------------------------------------+
               |                                           v
  +---------+  | Tick [.. < target - hyst]  +---------+  EmergencyShutoff  +-------------+
  | Standby |------------------------------>| Heating |------------------->| SafeLockout |
  |         |<------------------------------|         |                    |             |
  +---------+  Tick [.. >= target + hyst]   +---------+                    +-------------+
     |   ^                                       |                                 |
     |   |                                       | Tick [temp>=40 || cycle>=max]   | Reset
     |   | Tick [.. <= target - hyst]            v                                 |
     |   |     +---------+  Tick [temp>=40] +----------+                           |
     |   +-----| Cooling |----------------->| Cooldown |<--------------------------+
     +-------->|         |                  | (3 ticks)| (returned to Standby via Reset)
       Tick    +---------+                  +----------+
```

## Step 1: Switch Machine & Explore Compact Badges

1. In the top **Machine** selector, switch from `BlinkyController` to **`SmartThermostat`**.
2. Notice the **Fixed Layered Layout** (`⇄ LR` / `⇄ TB`) arranges all 5 states cleanly with horizontally fanned self-loops.
3. Enable **`🏷 Badges`** and inspect the left **`Events`** legend (`A = Tick`, `B = SetTarget`, `C = SetAmbient`, `D = ToggleEco`, `E = EmergencyShutoff`, `F = Reset`), or hover any edge badge for exact guard & hook details.

## Step 2: Watch Entry Hooks + Self-Transition Physics

1. Open **`Simulator`** and inspect **`Globals`**: `current_temp_c = 21.0`, `target_temp_c = 22.0`, `hysteresis_c = 1.0`.
2. Click **`⏭ Step Tick`** *(Step 1)*: inside deadband `[21.0, 23.0]`, **`Standby ↺ Standby` (`drift`)** fires (`tr_drift` cools passively from `21.0` to `20.25 C`).
3. Click **`⏭ Step Tick`** *(Step 2)*: now `20.25 < 21.0`, so **`Standby → Heating` (`start_heat`)** runs `Heating::on_enter` (`cycle_ticks = 0`, `status_note = "Heating"`).
4. Click **`⏭ Step Tick`** 3 more times *(Steps 3–5)*: **`Heating ↺ Heating` (`heat_step`)** heats the room (`21.34 → 22.30 → 23.14 C`, `energy_wh = 75 Wh`), incrementing `cycle_ticks` without re-running `on_enter`.
5. Click **`⏭ Step Tick`** *(Step 6)*: at `23.14 >= 23.0`, **`Heating → Standby` (`done_heat`)** enters **`Standby`** and resets `cycle_ticks = 0`.

## Step 3: Dispatch Typed `f64` Payloads (`SetTarget` & `SetAmbient`)

1. Under **Dispatch Event**, find **`SetTarget`** (with payload input `f64`):
   - Enter **`18.5`** and click **`SetTarget`**.
   - Look at `tr_set_target(globals, payload: f64)` in **`Action Hook`**: `globals.target_temp_c = payload.clamp(10.0, 32.0);` clamps safely without resetting `cycle_ticks` (`reenter = false`).
2. Step **`Tick`** once — since `current_temp_c > 18.5 + 1.0`, `SmartThermostat` enters **`Cooling`** (`cool_step` draws `20 Wh/tick` or `12 Wh/tick` in `eco_mode`).
3. Try raising `ambient_temp_c` using **`SetAmbient` = `38.0`** and stepping `Cooling` to observe realistic thermal load against external heat gain.

## Step 4: Duty-Limit Cooldown & Explicit Lockout Semantics

1. In Live **Globals**, click `max_cycle_ticks` and change `10` → **`3`** (`Heating` duty limit).
2. Set `target_temp_c = 30.0`, **`SetAmbient = 10.0`**, dispatch **`Tick`** into **`Heating`**, then click **`⏭ Step Tick`** cleanly:
   - On tick 3 (`cycle_ticks == 3`), **`Heating → Cooldown` (`overheat`)** satisfies `current_temp_c >= 40.0 || cycle_ticks >= max_cycle_ticks`, sets `globals.fault_code = 201;`, and enters **`Cooldown`** (`cycle_ticks = 3`).
   - Three subsequent `Tick`s count down `cycle_ticks` (`3 -> 2 -> 1 -> 0`) via `tr_cool_wait`, and **`Cooldown → Standby` (`recovered`)** clears `fault_code = 0`.
3. Dispatch **`EmergencyShutoff`** to jump from any active state to **`SafeLockout`** (`fault_code = 999`). Notice `SetTarget` is ignored in `SafeLockout` until **`Reset`** returns the controller to `Standby`.

## Step 5: Verify Mutual Exclusivity & Native Rust Parity

1. Click any outgoing `Tick` edge on `Standby`, `Heating`, or `Cooling` and open **`Guard & Exclusivity`**: every sibling pair is **formally proven mutually exclusive** (leveraging `hysteresis_c >= 0.0` from `GlobalVar.minValue = "0.0"`).
2. Click **`⚙ Verify in Native Rust`** under **Execution Trace** and confirm:
   `✓ Native Rust matches!`.
3. Open **`Heating`** (`Action Hook` for `tr_heat_step` in `examples/smart-thermostat/src/states/heating.rs`), update `let watts = if globals.eco_mode { 15.0 } else { 30.0 };`, save (`⌘S`), verify with **`✓ Verify with rustc`**, and re-run **Simulator** to observe `energy_wh` jump by `30 Wh` per tick.
