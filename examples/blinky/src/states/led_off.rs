//! State module: LedOff
//! Drives LED low and cools down slightly before the next pulse.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
    if globals.temperature_c > 25 {
        globals.temperature_c -= 1;
    }
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            if globals.blink_count >= globals.max_blinks {
                Outcome::Transition(StateId::Idle)
            } else {
                Outcome::Transition(StateId::LedOn)
            }
        }
        Event::Stop => Outcome::Transition(StateId::Idle),
        Event::FaultDetected => Outcome::Transition(StateId::Fault),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
