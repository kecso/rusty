#![allow(unused_variables)]
//! State hooks for: Fault
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering Fault
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
}

/// Exit action when leaving Fault
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}

/// Transition: Fault --(Reset)--> Idle
/// Guard: (unconditional)
// @rusty:hook tr:tr_reset
pub fn tr_reset(globals: &mut Globals) {
    globals.blink_count = 0;
    globals.temperature_c = 28;
}
