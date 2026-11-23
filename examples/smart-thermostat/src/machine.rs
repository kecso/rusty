//! Generated model-driven state machine dispatcher for SmartThermostat.
//! All topology, event dispatch, and mutual-exclusivity checks live here.

use crate::states;
use crate::types::{Event, Globals, StateId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum TransitionId {
    T0CooldownEmergencyShutoff,
    T1CoolingEmergencyShutoff,
    T2HeatingEmergencyShutoff,
    T3StandbyEmergencyShutoff,
    T4SafeLockoutReset,
    T5CoolingSetAmbient,
    T6HeatingSetAmbient,
    T7StandbySetAmbient,
    T8CoolingSetTarget,
    T9HeatingSetTarget,
    T10StandbySetTarget,
    T11CoolingTick,
    T12CooldownTick,
    T13CoolingTick,
    T14HeatingTick,
    T15StandbyTick,
    T16HeatingTick,
    T17CoolingTick,
    T18HeatingTick,
    T19StandbyTick,
    T20CooldownTick,
    T21StandbyTick,
    T22StandbyTick,
    T23CoolingToggleEco,
    T24HeatingToggleEco,
    T25StandbyToggleEco,
}

pub struct StateMachine {
    pub current: StateId,
    pub globals: Globals,
    pub step_count: u64,
}

impl StateMachine {
    pub fn new() -> Self {
        let mut sm = Self {
            current: StateId::Standby,
            globals: Globals::default(),
            step_count: 0,
        };
        sm.enter_current();
        sm
    }

    fn enter_current(&mut self) {
        match self.current {
            StateId::Standby => states::standby::on_enter(&mut self.globals),
            StateId::Heating => states::heating::on_enter(&mut self.globals),
            StateId::Cooling => states::cooling::on_enter(&mut self.globals),
            StateId::Cooldown => states::cooldown::on_enter(&mut self.globals),
            StateId::SafeLockout => states::safe_lockout::on_enter(&mut self.globals),
        }
    }

    fn exit_current(&mut self) {
        match self.current {
            StateId::Standby => states::standby::on_exit(&mut self.globals),
            StateId::Heating => states::heating::on_exit(&mut self.globals),
            StateId::Cooling => states::cooling::on_exit(&mut self.globals),
            StateId::Cooldown => states::cooldown::on_exit(&mut self.globals),
            StateId::SafeLockout => states::safe_lockout::on_exit(&mut self.globals),
        }
    }

    pub fn select_transition(&self, event: &Event) -> Option<TransitionId> {
        let globals = &self.globals;
        let _ = globals;
        let mut matched: Option<TransitionId> = None;
        match (self.current, event) {
            (StateId::Cooldown, Event::EmergencyShutoff) => {
                // @rusty:tr {"id":"T0CooldownEmergencyShutoff","src":"Cooldown","dst":"SafeLockout","event":"EmergencyShutoff","name":"shutoff","reenter":false,"fn":"tr_shutoff","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooldown on EmergencyShutoff");
                matched = Some(TransitionId::T0CooldownEmergencyShutoff);
            }
            (StateId::Cooling, Event::EmergencyShutoff) => {
                // @rusty:tr {"id":"T1CoolingEmergencyShutoff","src":"Cooling","dst":"SafeLockout","event":"EmergencyShutoff","name":"shutoff","reenter":false,"fn":"tr_shutoff","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooling on EmergencyShutoff");
                matched = Some(TransitionId::T1CoolingEmergencyShutoff);
            }
            (StateId::Heating, Event::EmergencyShutoff) => {
                // @rusty:tr {"id":"T2HeatingEmergencyShutoff","src":"Heating","dst":"SafeLockout","event":"EmergencyShutoff","name":"shutoff","reenter":false,"fn":"tr_shutoff","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Heating on EmergencyShutoff");
                matched = Some(TransitionId::T2HeatingEmergencyShutoff);
            }
            (StateId::Standby, Event::EmergencyShutoff) => {
                // @rusty:tr {"id":"T3StandbyEmergencyShutoff","src":"Standby","dst":"SafeLockout","event":"EmergencyShutoff","name":"shutoff","reenter":false,"fn":"tr_shutoff","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on EmergencyShutoff");
                matched = Some(TransitionId::T3StandbyEmergencyShutoff);
            }
            (StateId::SafeLockout, Event::Reset) => {
                // @rusty:tr {"id":"T4SafeLockoutReset","src":"SafeLockout","dst":"Standby","event":"Reset","name":"reset","reenter":false,"fn":"tr_reset","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in SafeLockout on Reset");
                matched = Some(TransitionId::T4SafeLockoutReset);
            }
            (StateId::Cooling, Event::SetAmbient(_)) => {
                // @rusty:tr {"id":"T5CoolingSetAmbient","src":"Cooling","dst":"Cooling","event":"SetAmbient","name":"set_ambient","reenter":false,"fn":"tr_set_ambient","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooling on SetAmbient");
                matched = Some(TransitionId::T5CoolingSetAmbient);
            }
            (StateId::Heating, Event::SetAmbient(_)) => {
                // @rusty:tr {"id":"T6HeatingSetAmbient","src":"Heating","dst":"Heating","event":"SetAmbient","name":"set_ambient","reenter":false,"fn":"tr_set_ambient","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Heating on SetAmbient");
                matched = Some(TransitionId::T6HeatingSetAmbient);
            }
            (StateId::Standby, Event::SetAmbient(_)) => {
                // @rusty:tr {"id":"T7StandbySetAmbient","src":"Standby","dst":"Standby","event":"SetAmbient","name":"set_ambient","reenter":false,"fn":"tr_set_ambient","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on SetAmbient");
                matched = Some(TransitionId::T7StandbySetAmbient);
            }
            (StateId::Cooling, Event::SetTarget(_)) => {
                // @rusty:tr {"id":"T8CoolingSetTarget","src":"Cooling","dst":"Cooling","event":"SetTarget","name":"set_target","reenter":false,"fn":"tr_set_target","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooling on SetTarget");
                matched = Some(TransitionId::T8CoolingSetTarget);
            }
            (StateId::Heating, Event::SetTarget(_)) => {
                // @rusty:tr {"id":"T9HeatingSetTarget","src":"Heating","dst":"Heating","event":"SetTarget","name":"set_target","reenter":false,"fn":"tr_set_target","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Heating on SetTarget");
                matched = Some(TransitionId::T9HeatingSetTarget);
            }
            (StateId::Standby, Event::SetTarget(_)) => {
                // @rusty:tr {"id":"T10StandbySetTarget","src":"Standby","dst":"Standby","event":"SetTarget","name":"set_target","reenter":false,"fn":"tr_set_target","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on SetTarget");
                matched = Some(TransitionId::T10StandbySetTarget);
            }
            (StateId::Cooling, Event::Tick) => {
                // @rusty:tr {"id":"T11CoolingTick","src":"Cooling","dst":"Cooling","event":"Tick","name":"cool_step","reenter":false,"fn":"tr_cool_step","guard":"current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c > target_temp_c - hysteresis_c"}
                if globals.current_temp_c < 40.0 && globals.cycle_ticks < globals.max_cycle_ticks && globals.current_temp_c > globals.target_temp_c - globals.hysteresis_c {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooling on Tick");
                    matched = Some(TransitionId::T11CoolingTick);
                }
                // @rusty:tr {"id":"T13CoolingTick","src":"Cooling","dst":"Standby","event":"Tick","name":"done_cool","reenter":false,"fn":"tr_done_cool","guard":"current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c <= target_temp_c - hysteresis_c"}
                if globals.current_temp_c < 40.0 && globals.cycle_ticks < globals.max_cycle_ticks && globals.current_temp_c <= globals.target_temp_c - globals.hysteresis_c {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooling on Tick");
                    matched = Some(TransitionId::T13CoolingTick);
                }
                // @rusty:tr {"id":"T17CoolingTick","src":"Cooling","dst":"Cooldown","event":"Tick","name":"overheat","reenter":false,"fn":"tr_overheat","guard":"current_temp_c >= 40.0 || cycle_ticks >= max_cycle_ticks"}
                if globals.current_temp_c >= 40.0 || globals.cycle_ticks >= globals.max_cycle_ticks {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooling on Tick");
                    matched = Some(TransitionId::T17CoolingTick);
                }
            }
            (StateId::Cooldown, Event::Tick) => {
                // @rusty:tr {"id":"T12CooldownTick","src":"Cooldown","dst":"Cooldown","event":"Tick","name":"cool_wait","reenter":false,"fn":"tr_cool_wait","guard":"cycle_ticks > 0"}
                if globals.cycle_ticks > 0 {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooldown on Tick");
                    matched = Some(TransitionId::T12CooldownTick);
                }
                // @rusty:tr {"id":"T20CooldownTick","src":"Cooldown","dst":"Standby","event":"Tick","name":"recovered","reenter":false,"fn":"tr_recovered","guard":"cycle_ticks == 0"}
                if globals.cycle_ticks == 0 {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooldown on Tick");
                    matched = Some(TransitionId::T20CooldownTick);
                }
            }
            (StateId::Heating, Event::Tick) => {
                // @rusty:tr {"id":"T14HeatingTick","src":"Heating","dst":"Standby","event":"Tick","name":"done_heat","reenter":false,"fn":"tr_done_heat","guard":"current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c >= target_temp_c + hysteresis_c"}
                if globals.current_temp_c < 40.0 && globals.cycle_ticks < globals.max_cycle_ticks && globals.current_temp_c >= globals.target_temp_c + globals.hysteresis_c {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Heating on Tick");
                    matched = Some(TransitionId::T14HeatingTick);
                }
                // @rusty:tr {"id":"T16HeatingTick","src":"Heating","dst":"Heating","event":"Tick","name":"heat_step","reenter":false,"fn":"tr_heat_step","guard":"current_temp_c < 40.0 && cycle_ticks < max_cycle_ticks && current_temp_c < target_temp_c + hysteresis_c"}
                if globals.current_temp_c < 40.0 && globals.cycle_ticks < globals.max_cycle_ticks && globals.current_temp_c < globals.target_temp_c + globals.hysteresis_c {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Heating on Tick");
                    matched = Some(TransitionId::T16HeatingTick);
                }
                // @rusty:tr {"id":"T18HeatingTick","src":"Heating","dst":"Cooldown","event":"Tick","name":"overheat","reenter":false,"fn":"tr_overheat","guard":"current_temp_c >= 40.0 || cycle_ticks >= max_cycle_ticks"}
                if globals.current_temp_c >= 40.0 || globals.cycle_ticks >= globals.max_cycle_ticks {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Heating on Tick");
                    matched = Some(TransitionId::T18HeatingTick);
                }
            }
            (StateId::Standby, Event::Tick) => {
                // @rusty:tr {"id":"T15StandbyTick","src":"Standby","dst":"Standby","event":"Tick","name":"drift","reenter":false,"fn":"tr_drift","guard":"current_temp_c < 45.0 && current_temp_c >= target_temp_c - hysteresis_c && current_temp_c <= target_temp_c + hysteresis_c"}
                if globals.current_temp_c < 45.0 && globals.current_temp_c >= globals.target_temp_c - globals.hysteresis_c && globals.current_temp_c <= globals.target_temp_c + globals.hysteresis_c {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on Tick");
                    matched = Some(TransitionId::T15StandbyTick);
                }
                // @rusty:tr {"id":"T19StandbyTick","src":"Standby","dst":"SafeLockout","event":"Tick","name":"overtemp","reenter":false,"fn":"tr_overtemp","guard":"current_temp_c >= 45.0"}
                if globals.current_temp_c >= 45.0 {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on Tick");
                    matched = Some(TransitionId::T19StandbyTick);
                }
                // @rusty:tr {"id":"T21StandbyTick","src":"Standby","dst":"Cooling","event":"Tick","name":"start_cool","reenter":false,"fn":"tr_start_cool","guard":"current_temp_c < 45.0 && current_temp_c > target_temp_c + hysteresis_c"}
                if globals.current_temp_c < 45.0 && globals.current_temp_c > globals.target_temp_c + globals.hysteresis_c {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on Tick");
                    matched = Some(TransitionId::T21StandbyTick);
                }
                // @rusty:tr {"id":"T22StandbyTick","src":"Standby","dst":"Heating","event":"Tick","name":"start_heat","reenter":false,"fn":"tr_start_heat","guard":"current_temp_c < 45.0 && current_temp_c < target_temp_c - hysteresis_c"}
                if globals.current_temp_c < 45.0 && globals.current_temp_c < globals.target_temp_c - globals.hysteresis_c {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on Tick");
                    matched = Some(TransitionId::T22StandbyTick);
                }
            }
            (StateId::Cooling, Event::ToggleEco) => {
                // @rusty:tr {"id":"T23CoolingToggleEco","src":"Cooling","dst":"Cooling","event":"ToggleEco","name":"toggle_eco","reenter":false,"fn":"tr_toggle_eco","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Cooling on ToggleEco");
                matched = Some(TransitionId::T23CoolingToggleEco);
            }
            (StateId::Heating, Event::ToggleEco) => {
                // @rusty:tr {"id":"T24HeatingToggleEco","src":"Heating","dst":"Heating","event":"ToggleEco","name":"toggle_eco","reenter":false,"fn":"tr_toggle_eco","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Heating on ToggleEco");
                matched = Some(TransitionId::T24HeatingToggleEco);
            }
            (StateId::Standby, Event::ToggleEco) => {
                // @rusty:tr {"id":"T25StandbyToggleEco","src":"Standby","dst":"Standby","event":"ToggleEco","name":"toggle_eco","reenter":false,"fn":"tr_toggle_eco","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Standby on ToggleEco");
                matched = Some(TransitionId::T25StandbyToggleEco);
            }
            _ => {}
        }
        matched
    }

    fn execute_transition(&mut self, tid: TransitionId, event: &Event) {
        let _ = event;
        match tid {
            TransitionId::T0CooldownEmergencyShutoff => {
                self.exit_current();
                states::cooldown::tr_shutoff(&mut self.globals);
                self.current = StateId::SafeLockout;
                self.enter_current();
            }
            TransitionId::T1CoolingEmergencyShutoff => {
                self.exit_current();
                states::cooling::tr_shutoff(&mut self.globals);
                self.current = StateId::SafeLockout;
                self.enter_current();
            }
            TransitionId::T2HeatingEmergencyShutoff => {
                self.exit_current();
                states::heating::tr_shutoff(&mut self.globals);
                self.current = StateId::SafeLockout;
                self.enter_current();
            }
            TransitionId::T3StandbyEmergencyShutoff => {
                self.exit_current();
                states::standby::tr_shutoff(&mut self.globals);
                self.current = StateId::SafeLockout;
                self.enter_current();
            }
            TransitionId::T4SafeLockoutReset => {
                self.exit_current();
                states::safe_lockout::tr_reset(&mut self.globals);
                self.current = StateId::Standby;
                self.enter_current();
            }
            TransitionId::T5CoolingSetAmbient => {
                if let Event::SetAmbient(payload) = event {
                    states::cooling::tr_set_ambient(&mut self.globals, *payload);
                }
            }
            TransitionId::T6HeatingSetAmbient => {
                if let Event::SetAmbient(payload) = event {
                    states::heating::tr_set_ambient(&mut self.globals, *payload);
                }
            }
            TransitionId::T7StandbySetAmbient => {
                if let Event::SetAmbient(payload) = event {
                    states::standby::tr_set_ambient(&mut self.globals, *payload);
                }
            }
            TransitionId::T8CoolingSetTarget => {
                if let Event::SetTarget(payload) = event {
                    states::cooling::tr_set_target(&mut self.globals, *payload);
                }
            }
            TransitionId::T9HeatingSetTarget => {
                if let Event::SetTarget(payload) = event {
                    states::heating::tr_set_target(&mut self.globals, *payload);
                }
            }
            TransitionId::T10StandbySetTarget => {
                if let Event::SetTarget(payload) = event {
                    states::standby::tr_set_target(&mut self.globals, *payload);
                }
            }
            TransitionId::T11CoolingTick => {
                states::cooling::tr_cool_step(&mut self.globals);
            }
            TransitionId::T12CooldownTick => {
                states::cooldown::tr_cool_wait(&mut self.globals);
            }
            TransitionId::T13CoolingTick => {
                self.exit_current();
                self.current = StateId::Standby;
                self.enter_current();
            }
            TransitionId::T14HeatingTick => {
                self.exit_current();
                self.current = StateId::Standby;
                self.enter_current();
            }
            TransitionId::T15StandbyTick => {
                states::standby::tr_drift(&mut self.globals);
            }
            TransitionId::T16HeatingTick => {
                states::heating::tr_heat_step(&mut self.globals);
            }
            TransitionId::T17CoolingTick => {
                self.exit_current();
                states::cooling::tr_overheat(&mut self.globals);
                self.current = StateId::Cooldown;
                self.enter_current();
            }
            TransitionId::T18HeatingTick => {
                self.exit_current();
                states::heating::tr_overheat(&mut self.globals);
                self.current = StateId::Cooldown;
                self.enter_current();
            }
            TransitionId::T19StandbyTick => {
                self.exit_current();
                states::standby::tr_overtemp(&mut self.globals);
                self.current = StateId::SafeLockout;
                self.enter_current();
            }
            TransitionId::T20CooldownTick => {
                self.exit_current();
                states::cooldown::tr_recovered(&mut self.globals);
                self.current = StateId::Standby;
                self.enter_current();
            }
            TransitionId::T21StandbyTick => {
                self.exit_current();
                self.current = StateId::Cooling;
                self.enter_current();
            }
            TransitionId::T22StandbyTick => {
                self.exit_current();
                self.current = StateId::Heating;
                self.enter_current();
            }
            TransitionId::T23CoolingToggleEco => {
                states::cooling::tr_toggle_eco(&mut self.globals);
            }
            TransitionId::T24HeatingToggleEco => {
                states::heating::tr_toggle_eco(&mut self.globals);
            }
            TransitionId::T25StandbyToggleEco => {
                states::standby::tr_toggle_eco(&mut self.globals);
            }
        }
    }

    pub fn dispatch(&mut self, event: &Event) -> (StateId, StateId) {
        let from = self.current;
        if let Some(tid) = self.select_transition(event) {
            self.execute_transition(tid, event);
        }
        self.step_count += 1;
        (from, self.current)
    }
}

impl Default for StateMachine {
    fn default() -> Self {
        Self::new()
    }
}
