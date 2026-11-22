//! State module: LedOn
//! Drives LED high and increments blink_count on entry.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = true;
    globals.blink_count += 1;
    globals.temperature_c += 2;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            if globals.temperature_c >= 75 {
                Outcome::Transition(StateId::Fault)
            } else {
                Outcome::Transition(StateId::LedOff)
            }
        }
        Event::Stop => Outcome::Transition(StateId::Idle),
        Event::FaultDetected => Outcome::Transition(StateId::Fault),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
