# Demo Showcase: BlinkyController

**`BlinkyController`** (`examples/blinky/`) is a pre-seeded "hello world" hardware state machine included in `RustyDemo`. While the [Counter Tutorial](./00-build-a-counter.md) teaches you how to build a machine from scratch, this showcase lets you immediately explore a multi-state blink loop, thermal fault protection, and native Rust verification.

![BlinkyController fixed layout, event badges, simulation, and native Rust parity](/images/demo-overview-blinky.gif)

## 1. Open `BlinkyController` in Rusty Studio

Start the server (`npm start` from your cloned fork) and open `http://127.0.0.1:8888/routers/studio`.

On first boot, Studio seeds **`RustyDemo`** from `RustySeed.webgmex` and opens **`BlinkyController`**. On the **Diagram** canvas, you'll see a clean fixed layered layout with four states:

- **`Idle`** (`INIT`) — ensures `globals.led_high = false`
- **`LedOn`** — drives `led_high = true`, increments `blink_count` and `temperature_c`
- **`LedOff`** — drives `led_high = false`, cools down slightly, returns to `Idle` at `max_blinks`
- **`Fault`** — safe latched state until `Reset`

Notice how transitions use compact letter badges (`A`, `B`, `C`, `D`, `E`) with distinct colors and dash styles matched to the **Events** legend on the left—hover any connector to inspect its full event and guard expression (`[globals.temperature_c >= 75]`) in a floating tooltip, or toggle **`⇄ LR` / `⇄ TB`** to flip layout direction.

## 2. Inspect State Code & Machine-Level Git Location

1. Click **`LedOn`** on the diagram or in the collapsible **States** sidebar.
2. In the right **Inspector & Rust** pane, see its inherited **Git File Location** (`examples/blinky/src/states/led_on.rs`, derived automatically from the machine's `examples/blinky` directory) alongside its tracked `dependsOn` references and live `< 1 ms` Monaco diagnostics.

## 3. Run the Simulator & Trigger a Fault

1. Switch the right pane tab to **Simulator**.
2. Click **`Start`** under **Dispatch Event**—**`LedOn`** glows green on the diagram and `blink_count` becomes `1`.
3. Click **`⏭ Step Tick`** repeatedly (or override `temperature_c` to `80` in **Live Globals** and step **`Tick`** to trigger **`Fault`**).
4. Click **`Reset`** to return cleanly to **`Idle`**.

## 4. Verify Behavior in Native Rust

Click **`⚙ Verify in Native Rust`** above the **Execution Trace**. Rusty generates the standalone crate, compiles it with `cargo`, replays your exact event sequence, and confirms the native Rust binary produces identical final state and globals.

Next: inspect the [SmartThermostat Showcase](./02-smart-thermostat.md) or follow the hands-on [Counter Tutorial](./00-build-a-counter.md).
