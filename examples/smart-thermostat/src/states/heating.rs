//! State module: Heating
//! Drives heater, computes thermal gain minus ambient loss, and logs energy_wh.

use crate::types::{Event, Globals, Outcome, StateId};

pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Heating");
}

pub fn on_event(globals: &mut Globals, event: &Event) -> Outcome {
    match event {
        Event::Tick => {
            let power_c = if globals.eco_mode { 1.0 } else { 1.75 };
            let watts = if globals.eco_mode { 15.0 } else { 25.0 };
            let loss = (globals.current_temp_c - globals.ambient_temp_c) * 0.125;
            globals.current_temp_c =
                ((globals.current_temp_c + power_c - loss) * 100.0).round() / 100.0;
            globals.energy_wh = ((globals.energy_wh + watts) * 100.0).round() / 100.0;
            globals.cycle_ticks += 1;

            if globals.current_temp_c >= 40.0 || globals.cycle_ticks >= globals.max_cycle_ticks {
                globals.fault_code = 201;
                Outcome::Emit(Event::OverheatAlert)
            } else if globals.current_temp_c >= globals.target_temp_c + globals.hysteresis_c {
                Outcome::Transition(StateId::Standby)
            } else {
                Outcome::Stay
            }
        }
        Event::OverheatAlert => Outcome::Transition(StateId::Cooldown),
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
