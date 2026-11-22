//! State module: Fault
//! Latched safety state — keeps LED off until operator sends Reset.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Reset => {
            globals.blink_count = 0;
            globals.temperature_c = 28;
            Outcome::Transition(StateId::Idle)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
