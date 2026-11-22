//! State module: Idle
//! Waiting for Start command; ensures LED is driven low.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Start => {
            globals.blink_count = 0;
            Outcome::Transition(StateId::LedOn)
        }
        Event::FaultDetected => Outcome::Transition(StateId::Fault),
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
