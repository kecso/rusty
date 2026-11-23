#![allow(unused_variables)]
//! State hooks for: Cooldown
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering Cooldown
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.cycle_ticks = 3;
    globals.status_note = String::from("Safety Cooldown");
}

/// Exit action when leaving Cooldown
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}

/// Transition: Cooldown --(EmergencyShutoff)--> SafeLockout
/// Guard: (unconditional)
// @rusty:hook tr:tr_shutoff
pub fn tr_shutoff(globals: &mut Globals) {
    globals.fault_code = 999;
}

/// Transition: Cooldown --(Tick)--> Cooldown (stay)
/// Guard: cycle_ticks > 0
// @rusty:hook tr:tr_cool_wait
pub fn tr_cool_wait(globals: &mut Globals) {
    let drift = (globals.ambient_temp_c - globals.current_temp_c) * 0.125;
    globals.current_temp_c = ((globals.current_temp_c + drift) * 100.0).round() / 100.0;
    globals.cycle_ticks -= 1;
}

/// Transition: Cooldown --(Tick)--> Standby
/// Guard: cycle_ticks == 0
// @rusty:hook tr:tr_recovered
pub fn tr_recovered(globals: &mut Globals) {
    globals.fault_code = 0;
}
