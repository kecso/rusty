#![allow(unused_variables)]
//! State hooks for: LedOn
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering LedOn
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.led_high = true;
    globals.blink_count += 1;
    globals.temperature_c += 2;
}

/// Exit action when leaving LedOn
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}
