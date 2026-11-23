# Tutorial 1: Build a Simple Counter From Scratch

Instead of only touring pre-built demos, this guide walks you through designing a small, real state machine—**`SimpleCounter`**—from an empty machine all the way to GitHub commits and a standalone Cargo crate.

`SimpleCounter` counts steps until it reaches a configurable threshold:

```
  [Ready] ──(Start)──▶ [Counting] ──(Increment [count >= limit])──▶ [LimitReached]
     ▲                                                                      │
     └───────────────────────────────(Reset)────────────────────────────────┘
```

## 1. Fork, Start & Sign In via GitHub

1. Fork [`https://github.com/kecso/rusty`](https://github.com/kecso/rusty) to `<your-username>/rusty`, clone your fork, and create a `dev` sandbox branch:
   ```bash
   git clone https://github.com/<your-username>/rusty.git
   cd rusty
   git checkout -b dev && git push -u origin dev
   npm install && npm start
   ```
   *(If you just want to try local drafts first without GitHub sync, skip OAuth setup and run `npm start` directly.)*
2. To sync files with GitHub, visit `http://127.0.0.1:8888/profile/login`, sign in with GitHub, and grant repository access to `<your-username>/rusty`.
3. Open **`http://127.0.0.1:8888/routers/studio`**.

## 2. Create the Machine & Point to Your GitHub Directory

1. In the top bar next to **Machine**, click **`+ Machine`**, name it **`SimpleCounter`**, and click **Create Machine**.
2. Click **`Bind GitHub Repo…`** in the Git Repository bar:
   - **Owner**: `<your-username>`
   - **Repo**: `rusty`
   - **Branch**: `dev`
   - **Machine Directory**: `examples/simple-counter`
3. Click **Bind & Save**.
   - Every state you create under `SimpleCounter` now automatically maps to `examples/simple-counter/src/states/<state_name>.rs`—you do not have to configure Git paths state by state (and can still override an individual state later if needed).

## 3. Add Shared Data, Events, and States

Use the collapsible **Explorer** lists on the left side of Studio:

1. **Add Globals** (`+ Var` under **Globals**):
   - `count` (`u32`, initial value `0`)
   - `limit` (`u32`, initial value `3`)
2. **Add Events** (`+ Event` under **Events**):
   - `Start` (unit event — leave payload empty)
   - `Increment` (unit event)
   - `Reset` (unit event)
   Notice each event automatically receives a letter badge (`A`, `B`, `C`) and distinct line style in the legend so diagrams stay readable even with many transitions.
3. **Add States** (`+ State` under **States**):
   - `Ready` (check **Initial State** in the right inspector and click **Save Design**)
   - `Counting`
   - `LimitReached`

Look at the center **Diagram** canvas: Rusty arranges your states cleanly in a deterministic **fixed layered layout** (`⇄ LR` or `⇄ TB`). You can hide either side panel (`◧` / `◨`) or collapse individual explorer lists at any time to focus on the diagram.

## 4. Wire Transitions & Guards

1. Click **`⇢ Edge`** in the diagram toolbar.
2. Click **`Ready`**, then click **`Counting`** → choose trigger event **`Start`** → click **Create Transition**.
3. Click **`⇢ Edge`**, connect **`Counting` → `Counting`**, choose **`Increment`** (optional guard: `globals.count + 1 < globals.limit`).
4. Click **`⇢ Edge`**, connect **`Counting` → `LimitReached`**, choose **`Increment`**, and set **Guard Expression**:
   ```rust
   globals.count + 1 >= globals.limit
   ```
5. Click **`⇢ Edge`**, connect **`LimitReached` → `Ready`**, choose **`Reset`**.
6. Hover over the badge on the `Counting → LimitReached` connector to see the full tooltip (`Increment`, `[globals.count + 1 >= globals.limit]`)—notice the flag symbol **`⚑`** tells you a guard is active without cluttering the diagram.

## 5. Author State Code with Continuous Checks

Select **`Counting`** and write its handler in the embedded Monaco editor:

```rust
use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.count = 0;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Increment => {
            globals.count += 1;
            if globals.count >= globals.limit {
                Outcome::Transition(StateId::LimitReached)
            } else {
                Outcome::Stay
            }
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
```

Notice two things right away:
- **Edit-Time Checks**: Try mistyping `globals.limit` as `globals.limt`—Monaco underlines it in `< 1 ms`. Fix it and notice the **Design Dependencies (`dependsOn` Set)** chips automatically track `var: count`, `var: limit`, `ev: Increment`, and `state: LimitReached` when you save.
- **Design Impact Detection**: Try clicking the edit icon (`✎`) on `limit` in **Globals** and renaming it to `max_count`. Immediately, an **Impact Banner** lights up at the top of the studio flagging both `Counting` and your guarded transition so no silent mismatch can slip through! Rename it back to `limit` (or update the code & guard and save) to clear the warning.
- Press **`⌘S` / `Ctrl+S`** (or click **`↑ Commit & Push`**) to commit `examples/simple-counter/src/states/counting.rs` straight to your fork's `dev` branch.

## 6. Test, Verify Natively & Export Your Standalone Crate

1. Switch the right pane to **Simulator** and dispatch **`Start`**, then **`Increment`** three times—watch `Counting` transition cleanly to `LimitReached` when `count` hits `3`.
2. Click **`⚙ Verify in Native Rust`** to compile and run the exact same sequence via `cargo`, confirming 100% behavioral parity.
3. Open the **Crate** tab in the center pane to inspect generated `Cargo.toml`, `src/types.rs`, and `src/machine.rs`—or click **`Push Full Crate`** to commit a completely self-contained Rust crate to GitHub that compiles and runs anywhere with zero dependency on Rusty Studio.

Next: explore [Edit-Time & Impact Checks](./03-edit-time-checks.md) or tour the pre-built [SmartThermostat Showcase](./02-smart-thermostat.md).
