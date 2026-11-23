# Rusty Tutorial Examples

Self-contained, runnable Rust state-machine crates synchronized with Rusty Studio's `RustySeed.webgmex` and pre-configured for the `dev` sandbox branch of **your own fork** (`<your-username>/rusty`).

| Directory | StateMachine | Highlights |
| --- | --- | --- |
| [`blinky/`](./blinky) | `BlinkyController` | Hello-world GPIO blink loop, Entry/Exit hooks, mutually exclusive thermal guard, `Fault` / `Reset` |
| [`smart-thermostat/`](./smart-thermostat) | `SmartThermostat` | Model-driven HVAC controller: `f64` physics in self-transition actions, payload events (`SetTarget:26.0`, `SetAmbient:35.0`), domain bounds, and proven mutually exclusive guards |

## Why Fork & Use a `dev` Branch?

In `RustySeed.webgmex`, both models already have their repository name, branch, and machine-level crate directory pre-filled:
- `gitOwner`: `""` *(click **Connect Git Repository…** in Studio once to connect `<your-username>`)*
- `gitRepo`: `rusty`
- `gitBranch`: `dev`
- `gitPath` (on `StateMachine`): `examples/<name>` *(states resolve automatically to `<dir>/src/states/<state>.rs`)*

By forking `kecso/rusty` and creating a `dev` branch in your fork, you can safely test **Pull from GitHub**, live **Monaco editing**, **Commit & Push (`⌘S`)**, **auto-rebase**, and **HTTP 409 3-way merge** without touching `main` or needing push access to upstream.

## Running Natively with Cargo

```bash
# Test and run SmartThermostat natively
cd examples/smart-thermostat
cargo test
cargo run -- SetTarget:26.0 Tick Tick Tick ToggleEco Tick EmergencyShutoff Reset
```

To regenerate these directories from `src/common/rustContract.js`:

```bash
npm run sync:examples
```
