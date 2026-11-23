//! Generated model-driven state machine dispatcher for BlinkyController.
//! All topology, event dispatch, and mutual-exclusivity checks live here.

use crate::states;
use crate::types::{Event, Globals, StateId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum TransitionId {
    T0IdleFaultDetected,
    T1LedOffFaultDetected,
    T2LedOnFaultDetected,
    T3FaultReset,
    T4IdleStart,
    T5LedOffStop,
    T6LedOnStop,
    T7LedOffTick,
    T8LedOffTick,
    T9LedOnTick,
    T10LedOnTick,
}

pub struct StateMachine {
    pub current: StateId,
    pub globals: Globals,
    pub step_count: u64,
}

impl StateMachine {
    pub fn new() -> Self {
        let mut sm = Self {
            current: StateId::Idle,
            globals: Globals::default(),
            step_count: 0,
        };
        sm.enter_current();
        sm
    }

    fn enter_current(&mut self) {
        match self.current {
            StateId::Idle => states::idle::on_enter(&mut self.globals),
            StateId::LedOn => states::led_on::on_enter(&mut self.globals),
            StateId::LedOff => states::led_off::on_enter(&mut self.globals),
            StateId::Fault => states::fault::on_enter(&mut self.globals),
        }
    }

    fn exit_current(&mut self) {
        match self.current {
            StateId::Idle => states::idle::on_exit(&mut self.globals),
            StateId::LedOn => states::led_on::on_exit(&mut self.globals),
            StateId::LedOff => states::led_off::on_exit(&mut self.globals),
            StateId::Fault => states::fault::on_exit(&mut self.globals),
        }
    }

    pub fn select_transition(&self, event: &Event) -> Option<TransitionId> {
        let globals = &self.globals;
        let _ = globals;
        let mut matched: Option<TransitionId> = None;
        match (self.current, event) {
            (StateId::Idle, Event::FaultDetected) => {
                // @rusty:tr {"id":"T0IdleFaultDetected","src":"Idle","dst":"Fault","event":"FaultDetected","name":"fault","reenter":false,"fn":"tr_fault","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Idle on FaultDetected");
                matched = Some(TransitionId::T0IdleFaultDetected);
            }
            (StateId::LedOff, Event::FaultDetected) => {
                // @rusty:tr {"id":"T1LedOffFaultDetected","src":"LedOff","dst":"Fault","event":"FaultDetected","name":"fault","reenter":false,"fn":"tr_fault","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOff on FaultDetected");
                matched = Some(TransitionId::T1LedOffFaultDetected);
            }
            (StateId::LedOn, Event::FaultDetected) => {
                // @rusty:tr {"id":"T2LedOnFaultDetected","src":"LedOn","dst":"Fault","event":"FaultDetected","name":"fault","reenter":false,"fn":"tr_fault","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOn on FaultDetected");
                matched = Some(TransitionId::T2LedOnFaultDetected);
            }
            (StateId::Fault, Event::Reset) => {
                // @rusty:tr {"id":"T3FaultReset","src":"Fault","dst":"Idle","event":"Reset","name":"reset","reenter":false,"fn":"tr_reset","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Fault on Reset");
                matched = Some(TransitionId::T3FaultReset);
            }
            (StateId::Idle, Event::Start) => {
                // @rusty:tr {"id":"T4IdleStart","src":"Idle","dst":"LedOn","event":"Start","name":"start","reenter":false,"fn":"tr_start","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in Idle on Start");
                matched = Some(TransitionId::T4IdleStart);
            }
            (StateId::LedOff, Event::Stop) => {
                // @rusty:tr {"id":"T5LedOffStop","src":"LedOff","dst":"Idle","event":"Stop","name":"stop","reenter":false,"fn":"tr_stop","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOff on Stop");
                matched = Some(TransitionId::T5LedOffStop);
            }
            (StateId::LedOn, Event::Stop) => {
                // @rusty:tr {"id":"T6LedOnStop","src":"LedOn","dst":"Idle","event":"Stop","name":"stop","reenter":false,"fn":"tr_stop","guard":""}
                debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOn on Stop");
                matched = Some(TransitionId::T6LedOnStop);
            }
            (StateId::LedOff, Event::Tick) => {
                // @rusty:tr {"id":"T7LedOffTick","src":"LedOff","dst":"Idle","event":"Tick","name":"done","reenter":false,"fn":"tr_done","guard":"blink_count >= max_blinks"}
                if globals.blink_count >= globals.max_blinks {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOff on Tick");
                    matched = Some(TransitionId::T7LedOffTick);
                }
                // @rusty:tr {"id":"T8LedOffTick","src":"LedOff","dst":"LedOn","event":"Tick","name":"next_pulse","reenter":false,"fn":"tr_next_pulse","guard":"blink_count < max_blinks"}
                if globals.blink_count < globals.max_blinks {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOff on Tick");
                    matched = Some(TransitionId::T8LedOffTick);
                }
            }
            (StateId::LedOn, Event::Tick) => {
                // @rusty:tr {"id":"T9LedOnTick","src":"LedOn","dst":"Fault","event":"Tick","name":"overheat","reenter":false,"fn":"tr_overheat","guard":"temperature_c >= 75"}
                if globals.temperature_c >= 75 {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOn on Tick");
                    matched = Some(TransitionId::T9LedOnTick);
                }
                // @rusty:tr {"id":"T10LedOnTick","src":"LedOn","dst":"LedOff","event":"Tick","name":"pulse_off","reenter":false,"fn":"tr_pulse_off","guard":"temperature_c < 75"}
                if globals.temperature_c < 75 {
                    debug_assert!(matched.is_none(), "Non-deterministic guard overlap in LedOn on Tick");
                    matched = Some(TransitionId::T10LedOnTick);
                }
            }
            _ => {}
        }
        matched
    }

    fn execute_transition(&mut self, tid: TransitionId, event: &Event) {
        let _ = event;
        match tid {
            TransitionId::T0IdleFaultDetected => {
                self.exit_current();
                self.current = StateId::Fault;
                self.enter_current();
            }
            TransitionId::T1LedOffFaultDetected => {
                self.exit_current();
                self.current = StateId::Fault;
                self.enter_current();
            }
            TransitionId::T2LedOnFaultDetected => {
                self.exit_current();
                self.current = StateId::Fault;
                self.enter_current();
            }
            TransitionId::T3FaultReset => {
                self.exit_current();
                states::fault::tr_reset(&mut self.globals);
                self.current = StateId::Idle;
                self.enter_current();
            }
            TransitionId::T4IdleStart => {
                self.exit_current();
                states::idle::tr_start(&mut self.globals);
                self.current = StateId::LedOn;
                self.enter_current();
            }
            TransitionId::T5LedOffStop => {
                self.exit_current();
                self.current = StateId::Idle;
                self.enter_current();
            }
            TransitionId::T6LedOnStop => {
                self.exit_current();
                self.current = StateId::Idle;
                self.enter_current();
            }
            TransitionId::T7LedOffTick => {
                self.exit_current();
                self.current = StateId::Idle;
                self.enter_current();
            }
            TransitionId::T8LedOffTick => {
                self.exit_current();
                self.current = StateId::LedOn;
                self.enter_current();
            }
            TransitionId::T9LedOnTick => {
                self.exit_current();
                self.current = StateId::Fault;
                self.enter_current();
            }
            TransitionId::T10LedOnTick => {
                self.exit_current();
                self.current = StateId::LedOff;
                self.enter_current();
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
