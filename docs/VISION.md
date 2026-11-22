# Vision: rusty

A deliberately small slice of CPS co-design:

1. **Model** a flat (later hierarchical) state machine in WebGME.
2. **Bind** each state to a Rust file in GitHub (`GitArtifactLink` / `webgme-git`).
3. **Generate** a composed crate: shared `Globals` + `Event` types from the model, one module per state from Git, dispatcher from transitions.
4. **Run** in-browser via WASM or locally as a native binary.

Recommended engine crates to evaluate first: **statig**, **finny**. Keep the per-state contract tiny (`on_event` / `Outcome`) so composition stays boring.
