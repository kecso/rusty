#![allow(unused_variables)]
//! State hooks for: LedOff
//! Topology and guards are generated in src/machine.rs.

use crate::types::Globals;

/// Entry action when entering LedOff
// @rusty:hook entry
pub fn on_enter(globals: &mut Globals) {
    globals.led_high = false;
    if globals.temperature_c > 25 {
        globals.temperature_c -= 1;
    }
}

/// Exit action when leaving LedOff
// @rusty:hook exit
pub fn on_exit(globals: &mut Globals) {}
