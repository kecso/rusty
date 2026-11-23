#![allow(unused_variables)]
//! State hooks for: Standby
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering Standby
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 0;
    globals.status_note = String::from("Standby");
}

/// Exit action when leaving Standby
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}

/// Transition: Standby --(EmergencyShutoff)--> SafeLockout
/// Guard: (unconditional)
// @rusty:hook tr:tr_shutoff
pub fn tr_shutoff(globals: &mut Globals) {
    globals.fault_code = 999;
}

/// Transition: Standby --(SetAmbient(f64))--> Standby (stay)
/// Guard: (unconditional)
// @rusty:hook tr:tr_set_ambient
pub fn tr_set_ambient(globals: &mut Globals, payload: f64) {
    globals.ambient_temp_c = payload.clamp(-20.0, 50.0);
}

/// Transition: Standby --(SetTarget(f64))--> Standby (stay)
/// Guard: (unconditional)
// @rusty:hook tr:tr_set_target
pub fn tr_set_target(globals: &mut Globals, payload: f64) {
    globals.target_temp_c = payload.clamp(10.0, 32.0);
}

/// Transition: Standby --(Tick)--> Standby (stay)
/// Guard: current_temp_c < 45.0 && current_temp_c >= target_temp_c - hysteresis_c && current_temp_c <= target_temp_c + hysteresis_c
// @rusty:hook tr:tr_drift
pub fn tr_drift(globals: &mut Globals) {
    let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;
    globals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;
}

/// Transition: Standby --(Tick)--> SafeLockout
/// Guard: current_temp_c >= 45.0
// @rusty:hook tr:tr_overtemp
pub fn tr_overtemp(globals: &mut Globals) {
    globals.fault_code = 101;
}

/// Transition: Standby --(ToggleEco)--> Standby (stay)
/// Guard: (unconditional)
// @rusty:hook tr:tr_toggle_eco
pub fn tr_toggle_eco(globals: &mut Globals) {
    globals.eco_mode = !globals.eco_mode;
    globals.hysteresis_c = if globals.eco_mode { 1.5 } else { 1.0 };
}
