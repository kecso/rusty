---
layout: home

hero:
  name: "Rusty Studio"
  text: "Model-Driven Visual Rust State Machines"
  tagline: "Design pure deterministic state machines visually in WebGME, prove guard mutual exclusivity formally, edit hook behavior in contextual read-only Monaco synced live to your GitHub fork, and verify against native rustc."
  image:
    src: /logo.svg
    alt: Rusty Studio rusty cogwheel machine logo
  actions:
    - theme: brand
      text: Get Started & Fork
      link: /getting-started
    - theme: alt
      text: Counter Tutorial
      link: /tutorial/00-build-a-counter
    - theme: alt
      text: Guard & Exclusivity Prover
      link: /concepts/model-driven-architecture

features:
  - title: Pure Model-Driven Control Flow
    details: WebGME owns every State, Event, bounded GlobalVar, Transition, and guard. States expose only on_enter and on_exit while transitions run squashed tr_* hooks—never StateId, Event, or ad-hoc branching.
  - title: Formal Guard Mutual-Exclusivity Proofs
    details: A pure Rust guard language backed by DNF expansion, BigInt rational Fourier-Motzkin elimination, and integer branch-and-bound proves determinism mathematically and reports concrete overlap counterexamples in <1 ms.
  - title: Contextual Read-Only Monaco + GitHub Sync
    details: Inspect full src/states/<state>.rs files at exact hook placement with all surrounding signatures locked read-only, while webgme-git pushes atomic commits to your fork's dev branch with auto-rebase and 3-way conflict resolution.
  - title: Interactive Simulator & Native rustc Parity
    details: Step through typed events, f64 payloads, self-transition physics, and design-impact warnings in the browser—then replay the exact trace in native Cargo builds via /routers/rustsim to prove bit-exact parity.
---

## Live Studio Preview

### `SmartThermostat`: Layered Layout, Guard Badges & Live Simulation

![SmartThermostat showcase in fixed layered layout with native parity](/images/demo-smart-thermostat.gif)

### Guard Exclusivity Prover, Read-Only Hook Editing & `rustc`

![Guard proofs, contextual read-only Monaco edit-time checks, and rustc verification](/images/demo-monaco-edit-checks.gif)
