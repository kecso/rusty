//! State module: Cooldown
//! Rests actuator for 3 ticks while allowing passive thermal equalization.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 3;
    globals.status_note = String::from("Safety Cooldown");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;
            globals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;
            if globals.cycle_ticks > 0 {
                globals.cycle_ticks -= 1;
            }
            if globals.cycle_ticks == 0 {
                globals.fault_code = 0;
                Outcome::Transition(StateId::Standby)
            } else {
                Outcome::Stay
            }
        }
        Event::EmergencyShutoff => {
            globals.fault_code = 999;
            Outcome::Transition(StateId::SafeLockout)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
