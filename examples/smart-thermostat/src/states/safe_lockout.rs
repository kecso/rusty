#![allow(unused_variables)]
//! State hooks for: SafeLockout
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering SafeLockout
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.status_note = String::from("LOCKED OUT - Reset required");
}

/// Exit action when leaving SafeLockout
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}

/// Transition: SafeLockout --(Reset)--> Standby
/// Guard: (unconditional)
// @rusty:hook tr:tr_reset
pub fn tr_reset(globals: &mut Globals) {
    globals.fault_code = 0;
    globals.cycle_ticks = 0;
    globals.current_temp_c = 21.0;
}
