---
layout: home

hero:
  name: "Rusty Studio"
  text: "Visual State Machine Design Meets Git-Backed Rust"
  tagline: "Design your machines visually in a version-controlled database, write state code stored natively in Git, catch mismatches as you type or reshape your design, and ship completely standalone Rust crates."
  actions:
    - theme: brand
      text: Start the Counter Tutorial
      link: /tutorial/00-build-a-counter
    - theme: alt
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: Demo Showcases
      link: /tutorial/02-smart-thermostat

features:
  - icon: 📐
    title: Visual Design, Version-Controlled
    details: Model your states, transitions, guards, events, and shared data visually while storing the entire machine architecture in a central version-controlled database.
  - icon: 🗂️
    title: Hybrid Code Stored in Plain Git
    details: Edit each state's Rust implementation inside the visual studio while the files themselves live in a regular Git repository that works seamlessly with any external IDE or CI pipeline.
  - icon: 🔍
    title: Continuous Edit & Impact Checks
    details: Every line of code and transition guard is checked in real time against your design, and whenever a design change affects existing state code, Rusty flags every impacted piece immediately.
  - icon: 📦
    title: Standalone Rust Crates & Verification
    details: Export clean, dependency-free Cargo crates where your design, transitions, and guards are compiled directly into Rust—verified interactively in the browser and against native cargo.
---

## See Rusty Studio in Action

### Clean Fixed Layout, Interactive Transitions & Native Verification

Browse states, shared data, and color-coded events in collapsible explorer panels, inspect guarded transitions via hover tooltips, and confirm browser runs match compiled native Rust:

![SmartThermostat showcase in fixed layered layout with native parity](/images/demo-smart-thermostat.gif)

### Design-Change Impact Tracking & Edit-Time Checks

Rename or retype a shared variable and immediately see every state and guard affected by the design change—then get sub-millisecond Monaco feedback and full compiler verification as you update your Rust code:

![Design impact tracking, Monaco edit-time checks, and rustc verification](/images/demo-monaco-edit-checks.gif)
