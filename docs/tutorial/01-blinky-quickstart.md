# Tutorial 1: BlinkyController Quickstart

**`BlinkyController`** (`examples/blinky/`) is Rusty's "hello world" hardware state machine. In 5 minutes you will inspect its WebGME topology, simulate a full blink loop, inject a live thermal fault, and verify parity against compiled native Rust.

![BlinkyController simulation and native Rust parity](/images/demo-overview-blinky.gif)

## 1. Open Rusty Studio

Start the server (`npm start` from your cloned fork) and open `http://127.0.0.1:8888/routers/studio`.

On first boot, Studio seeds **`RustyDemo`** from `RustySeed.webgmex` and selects **`BlinkyController`**. You will see four states on the SVG canvas:

- **`Idle`** (`INIT`) — ensures `globals.led_high = false`
- **`LedOn`** — sets `led_high = true`, increments `blink_count += 1` and `temperature_c += 2`
- **`LedOff`** — sets `led_high = false`, cools `temperature_c -= 1`, checks `blink_count >= max_blinks`
- **`Fault`** — safe latched state until `Event::Reset`

## 2. Inspect State Code in Monaco

1. Click **`LedOn`** on the canvas or in the left **States** sidebar.
2. In the right **Inspector & Rust** pane, review its `GitArtifactLink` coordinates (`gitRepo = rusty`, `gitBranch = dev`, `gitPath = examples/blinky/src/states/led_on.rs`, with `gitOwner` bound to `<your-username>` when you connect your fork in [Tutorial 4](./04-github-sync-dev.md)).
3. Look at the Monaco editor and analyzer status bar (`✓ 0 errors` in under 1ms).

## 3. Run the Dynamic Browser Simulator

1. Switch the right pane tab to **Dynamic Simulator**.
2. Click **`Start`** under **Inject Event**.
   - The **`LedOn`** box glows green on the diagram and an animated pulse travels along the `Start` arrow!
   - Watch **Live Globals**: `led_high` flips to `true`, `blink_count` becomes `1`, `temperature_c` becomes `30`.
3. Click **`▶ Auto-Tick`** (or press **`⏭ Step Tick`** repeatedly).
   - Every `Tick` alternates `LedOn` ↔ `LedOff` until `blink_count` reaches `max_blinks` (`5`), then automatically returns to `Idle`.

## 4. Inject a Live Thermal Fault

1. Click **`Start`** again so the machine enters `LedOn`.
2. In the **Live Globals** table, click the value button next to `temperature_c` and enter `80`.
3. Click **`⏭ Step Tick`**.
   - `LedOn::on_event` sees `globals.temperature_c >= 75` and transitions immediately to **`Fault`**, turning `led_high` back to `false`.
4. Click **`Reset`** to return cleanly to `Idle`.

## 5. Verify Native Rust Parity

Click **`🦀 Verify in Native Rust`** above the Execution Trace:

- Studio sends your WebGME model and exact injected event sequence to `/routers/rustsim/run`.
- The server generates the Rust crate, compiles it with `cargo run --offline`, replays your trace in the compiled binary, and confirms the native binary ended in the exact same state (`✓ Native Rust matches browser sim!`).

Next: continue to [Tutorial 2: SmartThermostat (Full Showcase)](./02-smart-thermostat.md) to work with floating-point physics, payload events, and self-emitted events!
