//! State module: Standby
//! Applies passive ambient thermal drift and checks deadband thresholds.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Standby");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;
            globals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;
            if globals.current_temp_c >= 45.0 {
                globals.fault_code = 101;
                Outcome::Transition(StateId::SafeLockout)
            } else if globals.current_temp_c < globals.target_temp_c - globals.hysteresis_c {
                Outcome::Transition(StateId::Heating)
            } else if globals.current_temp_c > globals.target_temp_c + globals.hysteresis_c {
                Outcome::Transition(StateId::Cooling)
            } else {
                Outcome::Stay
            }
        }
        Event::SetTarget(t) => {
            globals.target_temp_c = t.clamp(10.0, 32.0);
            Outcome::Stay
        }
        Event::SetAmbient(a) => {
            globals.ambient_temp_c = a.clamp(-20.0, 50.0);
            Outcome::Stay
        }
        Event::ToggleEco => {
            globals.eco_mode = !globals.eco_mode;
            globals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };
            Outcome::Stay
        }
        Event::EmergencyShutoff => {
            globals.fault_code = 999;
            Outcome::Transition(StateId::SafeLockout)
        }
        _ => Outcome::Stay,
    }
}

pub fn on_exit(_globals: &mut Globals) {}
