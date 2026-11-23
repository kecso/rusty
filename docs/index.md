---
layout: home

hero:
  name: "Rusty Studio"
  text: "WebGME State Machines Meet GitHub-Synced Rust"
  tagline: "Model topology and shared globals in WebGME. Author per-state Rust code in Monaco with sub-millisecond edit-time checks, sync atomically via webgme-git, and simulate live in the browser or native cargo."
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: SmartThermostat Tutorial
      link: /tutorial/02-smart-thermostat
    - theme: alt
      text: GitHub Sync on dev
      link: /tutorial/04-github-sync-dev

features:
  - icon: 🧬
    title: WebGME Owns Topology & Data
    details: StateMachine, State, Transition, GlobalVar, and EventDef live in WebGME. The Studio UI reads live territories and commits every edit via GME.classes.Client transactions.
  - icon: 🐙
    title: webgme-git Owns Rust State Code
    details: Opening a state auto-fetches its .rs module from GitHub via Octokit. Cmd/Ctrl+S commits and pushes atomically with auto-rebase and 3-way merge conflict resolution.
  - icon: ⚡
    title: Sub-Millisecond Edit-Time Checks
    details: Embedded Monaco validates globals.* fields, Event::* payloads, Outcome::Emit handling, and StateId::* topology against your live WebGME model on every keystroke.
  - icon: 🦀
    title: Dynamic Sim + Native Rust Parity
    details: Step or auto-tick in the browser with live globals injection, then verify 100% behavioral parity by compiling and running the generated Cargo crate via rustc.
---

## See Rusty Studio in Action

### Live Browser Simulation + Native `cargo` Parity

Switch between seeded state machines, step physics & payload events in the browser with glowing SVG state highlights, and verify 100% behavioral parity against compiled Rust (`rustc` / `cargo`):

![SmartThermostat physics simulation and native Rust parity](/images/demo-smart-thermostat.gif)

### Sub-Millisecond Monaco Edit-Time Checks + `rustc` Verification

As you type Rust state handlers, `RustyAnalyzer` validates globals, payload events, and WebGME transition topology in `< 1 ms`, then overlays full `cargo check` diagnostics on demand:

![Monaco edit-time checks and rustc verification](/images/demo-monaco-edit-checks.gif)
