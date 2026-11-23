# Reference: Edit-Time Diagnostics (`RustyAnalyzer`)

`src/common/rustAnalyzer.js` executes synchronously in the browser on every edit (55ms debounce) and maps directly onto Monaco Editor markers.

## Diagnostic Codes

| Code | Severity | Meaning |
| --- | --- | --- |
| `RUSTY_E001` | Error | Reference to an undefined `globals.<field>` (includes Levenshtein typo suggestion) |
| `RUSTY_E002` | Error | Compound operator (`+=`, `-=`, `*=`, `/=`) applied to a non-numeric global (`bool` or `String`) |
| `RUSTY_E003` | Error | Literal type mismatch in `globals.<field> = <literal>` (including negative literal assigned to `u32`/`u64`/`usize`) |
| `RUSTY_E010` | Error | Unknown `Event::<Variant>` not defined as an `EventDef` in WebGME (includes typo suggestion) |
| `RUSTY_E011` | Error | Event payload arity mismatch (unit event given `(...)` or payload event missing `(...)`) |
| `RUSTY_E012` | Error | Literal payload type mismatch inside `Outcome::Emit(Event::<Variant>(...))` |
| `RUSTY_W013` | Warning | Self-emitted `Outcome::Emit(Event::...)` is not handled by `on_event` or an outgoing WebGME `Transition` on the active state |
| `RUSTY_W014` | Warning | `emit!(...)` macro used instead of the `#![no_std]` contract `Outcome::Emit(Event::...)` |
| `RUSTY_E020` | Error | Unknown `StateId::<Name>` not defined as a `State` in WebGME (includes typo suggestion) |
| `RUSTY_W021` | Warning | `Outcome::Transition(StateId::<Name>)` has no matching WebGME `Transition` edge from the active state |
| `RUSTY_E030` | Error | Missing required `pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome` |
| `RUSTY_W031` | Warning | Missing `pub fn on_enter(...)` or `pub fn on_exit(...)` lifecycle function |
| `RUSTY_E032` | Error | Unbalanced delimiter (`{`, `}`, `(`, `)`, `[`, `]`) |
| `DESIGN_GLOBAL_RENAMED` | Error | Referenced `GlobalVar` tracked in `dependsOn` was renamed in the design |
| `DESIGN_GLOBAL_REMOVED` | Error | Referenced `GlobalVar` tracked in `dependsOn` was removed from the design |
| `DESIGN_TYPE_CHANGED` | Warning | Type (`rustType`) of a referenced `GlobalVar` changed — review & recheck state code or guard |
| `DESIGN_EVENT_RENAMED` | Error | Referenced `EventDef` tracked in `dependsOn` was renamed |
| `DESIGN_EVENT_REMOVED` | Error | Referenced `EventDef` tracked in `dependsOn` was removed |
| `DESIGN_PAYLOAD_CHANGED` | Warning | Payload type of a referenced `EventDef` changed |
| `DESIGN_STATE_RENAMED` | Error | Referenced target `State` tracked in `dependsOn` was renamed |
| `DESIGN_STATE_REMOVED` | Error | Referenced target `State` tracked in `dependsOn` was deleted |
| `DESIGN_DEPENDENCY_MISSING` | Warning | Dangling member inside WebGME `dependsOn` Set requires code review |
