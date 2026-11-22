//! Generated state machine dispatcher for BlinkyController.

use crate::states;
use crate::types::{Event, Globals, Outcome, StateId};

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

    fn evaluate_model_transitions(&self, event: &Event) -> Option<StateId> {
        let globals = &self.globals;
        let _ = (globals, event);
        if self.current == StateId::LedOn && matches!(event, Event::Tick) && (globals.temperature_c >= 75) {
            return Some(StateId::Fault);
        }
        if self.current == StateId::LedOff && matches!(event, Event::Tick) && (globals.blink_count >= globals.max_blinks) {
            return Some(StateId::Idle);
        }
        if self.current == StateId::Idle && matches!(event, Event::FaultDetected) {
            return Some(StateId::Fault);
        }
        if self.current == StateId::LedOn && matches!(event, Event::FaultDetected) {
            return Some(StateId::Fault);
        }
        if self.current == StateId::LedOff && matches!(event, Event::FaultDetected) {
            return Some(StateId::Fault);
        }
        if self.current == StateId::Idle && matches!(event, Event::Start) {
            return Some(StateId::LedOn);
        }
        if self.current == StateId::LedOn && matches!(event, Event::Tick) && (globals.temperature_c < 75) {
            return Some(StateId::LedOff);
        }
        if self.current == StateId::LedOff && matches!(event, Event::Tick) && (globals.blink_count < globals.max_blinks) {
            return Some(StateId::LedOn);
        }
        if self.current == StateId::Fault && matches!(event, Event::Reset) {
            return Some(StateId::Idle);
        }
        if self.current == StateId::LedOn && matches!(event, Event::Stop) {
            return Some(StateId::Idle);
        }
        if self.current == StateId::LedOff && matches!(event, Event::Stop) {
            return Some(StateId::Idle);
        }
        None
    }

    pub fn dispatch(&mut self, event: &Event) -> (StateId, StateId) {
        let initial_from = self.current;
        let mut pending: Option<Event> = Some(event.clone());
        let mut depth = 0u8;

        while let Some(current_ev) = pending.take() {
            if depth >= 8 {
                break;
            }
            depth += 1;

            let outcome = match self.current {
            StateId::Idle => states::idle::on_event(&mut self.globals, &current_ev),
            StateId::LedOn => states::led_on::on_event(&mut self.globals, &current_ev),
            StateId::LedOff => states::led_off::on_event(&mut self.globals, &current_ev),
            StateId::Fault => states::fault::on_event(&mut self.globals, &current_ev),
            };

            let next_state = match outcome {
                Outcome::Transition(target) => Some(target),
                Outcome::Emit(emitted) => {
                    pending = Some(emitted);
                    None
                }
                Outcome::Stay => self.evaluate_model_transitions(&current_ev),
            };

            if let Some(target) = next_state {
                if target != self.current {
                    self.exit_current();
                    self.current = target;
                    self.enter_current();
                }
            }
        }

        self.step_count += 1;
        (initial_from, self.current)
    }
}

impl Default for StateMachine {
    fn default() -> Self {
        Self::new()
    }
}
