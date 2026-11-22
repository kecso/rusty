# Rusty Tutorial Examples

Self-contained, runnable Rust state-machine crates synchronized with Rusty Studio's `RustySeed.webgmex` and pre-bound to the `dev` sandbox branch of `kecso/rusty`.

| Directory | StateMachine | Highlights |
| --- | --- | --- |
| [`blinky/`](./blinky) | `BlinkyController` | Hello-world GPIO blink loop, thermal limit guard, `Fault` / `Reset` recovery |
| [`smart-thermostat/`](./smart-thermostat) | `SmartThermostat` | Physics-computing HVAC controller: `f64` thermal drift & `energy_wh`, payload events (`SetTarget:26.0`, `SetAmbient:35.0`), `Outcome::Emit(Event::OverheatAlert)`, `Cooldown`, `SafeLockout` |

## Why the `dev` Branch?

Both models in `RustySeed.webgmex` bind their `GitArtifactLink` attributes to:
- `gitOwner`: `kecso`
- `gitRepo`: `rusty`
- `gitBranch`: `dev`
- `gitPath`: `examples/<name>/src/states/<state>.rs`

This lets you test **Pull from GitHub**, live **Monaco editing**, **Commit & Push (`⌘S`)**, **auto-rebase**, and **HTTP 409 3-way merge** directly against `dev` without modifying `main`.

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
