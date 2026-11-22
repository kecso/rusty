//! State module: SafeLockout
//! Latched fault state; disables HVAC outputs until operator sends Reset.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.status_note = String::from("LOCKED OUT - Reset required");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Reset => {
            globals.fault_code = 0;
            globals.cycle_ticks = 0;
            globals.current_temp_c = 21.0;
            Outcome::Transition(StateId::Standby)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
