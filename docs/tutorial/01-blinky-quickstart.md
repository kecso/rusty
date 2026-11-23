# Showcase: `BlinkyController` Quickstart

**`BlinkyController`** (`examples/blinky/`) is a pre-seeded "hello world" hardware state machine included in `RustyDemo`. While the [Counter Tutorial](./00-build-a-counter.md) teaches you how to build a machine from scratch, this showcase lets you immediately explore pure `Entry` / `Exit` hooks, mutually exclusive temperature & blink-count guards, compact event badges, and native Rust verification.

![BlinkyController fixed layout, event badges, simulation, and native Rust parity](/images/demo-overview-blinky.gif)

## 1. Tour the Workspace

1. Start Rusty Studio (`npm start`) and open `http://127.0.0.1:8888/routers/studio`.
2. Ensure **`BlinkyController`** is selected in the **Machine** dropdown.
3. Try the visual enhancements:
   - **Collapsible Side Lists**: Click `▾ States`, `▾ Globals`, or `▾ Events` to focus, or click **`◧` / `◨`** to hide either side panel completely.
   - **Compact Event Badges**: Click **`🏷 Badges`** to switch between compact letter badges (`A`..`E`) with distinct stroke patterns and full transition labels. Hover any connector badge for a rich Event + `[Guard]` + `tr_*` tooltip.
   - **Fixed Layered Layout**: Toggle **`⇄ LR`** / **`⇄ TB`** in the diagram toolbar.

## 2. Inspect Pure Model-Driven Hooks & Guards

- **States (`Entry` / `Exit` / `Transitions` tabs)**: Click **`LedOn`**. On the **`Entry`** tab, `src/states/led_on.rs` shows only `on_enter` and `on_exit`—with zero `StateId` or `Event` boilerplate:
  ```rust
  globals.led_high = true;
  globals.blink_count += 1;
  globals.temperature_c += 2;
  ```
- **Transitions (`Guard & Exclusivity` / `Action Hook` tabs)**: Click **`LedOn → Fault` (`Tick`)** to see its guard `temperature_c >= 75` proven mutually exclusive with **`LedOn → LedOff` (`Tick`)** (`temperature_c < 75`). No ambiguous ordering rules are needed.

## 3. Run Simulator & Verify Native Rust Parity

1. Switch the right pane to the **`Simulator`** tab.
2. Click **`Start`** in **Dispatch Event** — transitions `Idle -> LedOn` (runs `Idle -> LedOn` `tr_start` action `globals.blink_count = 0;` followed by `LedOn::on_enter`, setting `led_high = true`, `blink_count = 1`, `temperature_c = 30`).
3. Click **`▶ Auto-Tick`** (or **`⏭ Step Tick`**) to watch pulses alternate between **`LedOn`** and **`LedOff`** until `blink_count >= max_blinks` transitions **`LedOff → Idle`**.
4. In **Live Globals**, click `temperature_c`'s value and set it to **`75`**, dispatch **`Start`**, then **`⏭ Step Tick`** — the mutually exclusive overheat guard transitions `LedOn -> Fault`.
5. Click **`⚙ Verify in Native Rust`** under **Execution Trace** — Rusty generates the Cargo crate, runs `cargo run`, and confirms every state and `Globals` field matches the browser simulator identically.

Next: inspect the [SmartThermostat Showcase](./02-smart-thermostat.md) or follow the hands-on [Counter Tutorial](./00-build-a-counter.md).
