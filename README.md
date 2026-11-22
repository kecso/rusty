# rusty

Rust state-machine modeling studio: **WebGME owns topology** (states, transitions, globals), **GitHub owns behavior** (Rust per state), and a generator composes them into **WASM** (browser simulator) or a **native** executable.

Sibling under `_ROBOT_`:

- [`webgme-git`](https://github.com/kecso/webgme-git) — GitHub App OAuth + `GitArtifactLink` + `gitrouter`
- [`cps-build-studio`](https://github.com/kecso/cps-build-studio) — broader CPS co-design (this is a smaller vertical slice)

## Intent

| Layer | Source of truth | Notes |
| --- | --- | --- |
| States / transitions / globals | WebGME model | Diagram + typed context |
| State body code | GitHub (via `GitArtifactLink`) | Fixed Rust trait / `step` contract |
| Engine | Generated wiring + crate (e.g. [statig](https://github.com/mdeloof/statig) / [finny](https://docs.rs/finny)) | Prefer `#![no_std]`-friendly |
| Run | `sim-wasm` and/or local binary | Same crate, two targets |

## Status

Scaffold / planning. Next: metamodel seed, codegen sketch, hello-world blinky machine.

## License

MIT
