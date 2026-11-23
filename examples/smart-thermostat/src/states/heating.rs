#![allow(unused_variables)]
//! State hooks for: Heating
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering Heating
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Heating");
}

/// Exit action when leaving Heating
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}

/// Transition: Heating --(EmergencyShutoff)--> SafeLockout
/// Guard: (unconditional)
// @rusty:hook tr:tr_shutoff
pub fn tr_shutoff(globals: &mut Globals) {
    globals.fault_code = 999;
}

/// Transition: Heating --(SetAmbient(f64))--> Heating (stay)
/// Guard: (unconditional)
// @rusty:hook tr:tr_set_ambient
pub fn tr_set_ambient(globals: &mut Globals, payload: f64) {
    globals.ambient_temp_c = payload.clamp(-20.0, 50.0);
}

/// Transition: Heating --(SetTarget(f64))--> Heating (stay)
/// Guard: (unconditional)
// @rusty:hook tr:tr_set_target
pub fn tr_set_target(globals: &mut Globals, payload: f64) {
    globals.target_temp_c = payload.clamp(10.0, 32.0);
}

/// Transition: Heating --(Tick)--> Heating (stay)
/// Guard: current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c < target_temp_c + hysteresis_c
// @rusty:hook tr:tr_heat_step
pub fn tr_heat_step(globals: &mut Globals) {
    let power_c = if globals.eco_mode { 1.0 } else { 1.75 };
    let watts = if globals.eco_mode { 15.0 } else { 25.0 };
    let loss = (globals.current_temp_c - globals.ambient_temp_c) * 0.125;
    globals.current_temp_c = ((globals.current_temp_c + power_c - loss) * 100.0).round() / 100.0;
    globals.energy_wh = ((globals.energy_wh + watts) * 100.0).round() / 100.0;
    globals.cycle_ticks += 1;
}

/// Transition: Heating --(Tick)--> Cooldown
/// Guard: current_temp_c >= 40.0 || cycle_ticks >= max_cycle_ticks
// @rusty:hook tr:tr_overheat
pub fn tr_overheat(globals: &mut Globals) {
    globals.fault_code = 201;
}

/// Transition: Heating --(ToggleEco)--> Heating (stay)
/// Guard: (unconditional)
// @rusty:hook tr:tr_toggle_eco
pub fn tr_toggle_eco(globals: &mut Globals) {
    globals.eco_mode = !globals.eco_mode;
    globals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };
}
