#![allow(unused_variables)]
//! State hooks for: Idle
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering Idle
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
}

/// Exit action when leaving Idle
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}

/// Transition: Idle --(Start)--> LedOn
/// Guard: (unconditional)
// @rusty:hook tr:tr_start
pub fn tr_start(globals: &mut Globals) {
    globals.blink_count = 0;
}
