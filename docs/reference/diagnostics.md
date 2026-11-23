# Reference: Edit-Time, Guard & Design-Impact Diagnostics

Rusty runs three instant (`< 1 ms`) static passes in the browser alongside native `cargo check`.

## 1. Pure Guard Expression Codes (`src/common/rustGuardLang.js`)

| Code | Severity | Meaning |
| --- | --- | --- |
| `RUSTY_G001` | Error | Guard lexer/parser syntax error (unterminated string, bad numeric literal, unexpected token, missing operand) |
| `RUSTY_G002` | Error | Forbidden imperative construct in guard (`=`, `+=`, `-=`, `*=`, `/=`, `::`, `{}`, `;`, `/`, `%`, `?`, `&`, `\|`) — guards must stay pure expressions |
| `RUSTY_G005` | Error | Top-level guard expression does not evaluate to `bool` |
| `RUSTY_G006` | Error | `payload` referenced in guard, but the trigger event carries no payload |
| `RUSTY_E001` | Error | Unknown `GlobalVar` referenced inside a guard (with closest-match quick fix) |
| `RUSTY_E003` | Error | Type mismatch inside guard arithmetic, comparison, or boolean operator |
| `RUSTY_E010` | Error | Transition trigger `event` is not defined as an `EventDef` in WebGME |
| `RUSTY_E032` | Error | Unmatched closing `)` or missing parenthesis in guard |

## 2. State & Transition Hook Codes (`src/common/rustAnalyzer.js`)

| Code | Severity | Meaning |
| --- | --- | --- |
| `RUSTY_E001` | Error | Unknown `globals.<field>` — not a WebGME `GlobalVar` (includes Levenshtein quick fix) |
| `RUSTY_E002` | Error | Arithmetic compound operator (`+=`, `-=`, `*=`, `/=`) applied to non-numeric `bool` or `String` global |
| `RUSTY_E003` | Error | Type mismatch (e.g., negative literal assigned to `u32`, string assigned to numeric type, or float literal assigned to integer) |
| `RUSTY_E032` | Error | Unbalanced delimiter (`{ }`, `( )`, `[ ]`) across hook body or state module |
| `RUSTY_E040` | Error | Forbidden control-flow reference (`StateId::*`, `Event::*`, or transition control enums) inside hook code — transitions and events belong strictly to the design |
| `RUSTY_E041` | Error | Invalid `payload` reference inside `on_enter`, `on_exit`, or a unit-event transition `tr_*` hook |
| `RUSTY_W031` | Warning | Missing `pub fn on_enter(globals: &mut Globals)` or `pub fn on_exit(globals: &mut Globals)` in composed state file |

## 3. Design-Change Impact & Exclusivity Codes (`computeDesignImpact`)

Triggered whenever a WebGME `GlobalVar` / `EventDef` / guard changes and affects existing code, `dependsOn` Sets, or sibling transition determinism:

| Code | Severity | Meaning |
| --- | --- | --- |
| `DESIGN_GUARD_OVERLAP` | Error | Two sibling transitions on the same `(State, Event)` can fire simultaneously; reports the verified concrete counterexample (e.g. `current_temp_c = 40, ...`) |
| `DESIGN_GUARD_UNVERIFIED` | Warning | Non-linear arithmetic or unsupported predicate could not be automatically proven exclusive by the rational/integer solver |
| `DESIGN_GLOBAL_REMOVED` | Error | A `GlobalVar` previously referenced in `dependsOn` was deleted |
| `DESIGN_GLOBAL_RENAMED` | Warning | A `GlobalVar` in `dependsOn` was renamed in WebGME — update `globals.<name>` or guard references |
| `DESIGN_TYPE_CHANGED` | Warning | A `GlobalVar`'s `rustType` changed since this hook/guard was last saved |
| `DESIGN_EVENT_REMOVED` | Error | An `EventDef` referenced by a transition was deleted |
| `DESIGN_EVENT_RENAMED` | Warning | An `EventDef` in `dependsOn` was renamed |
| `DESIGN_PAYLOAD_CHANGED` | Warning | An `EventDef`'s `payloadType` changed |
| `DESIGN_DEPENDENCY_MISSING` | Warning | Referenced `dependsOn` Set member no longer exists — recheck code |
