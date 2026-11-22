//! Generated state machine dispatcher for SmartThermostat.

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

    fn evaluate_model_transitions(&self, event: &Event) -> Option<StateId> {
        let globals = &self.globals;
        let _ = (globals, event);
        if self.current == StateId::Standby && matches!(event, Event::Tick) && (globals.current_temp_c >= 45.0) {
            return Some(StateId::SafeLockout);
        }
        if self.current == StateId::Standby && matches!(event, Event::EmergencyShutoff) {
            return Some(StateId::SafeLockout);
        }
        if self.current == StateId::Heating && matches!(event, Event::OverheatAlert) {
            return Some(StateId::Cooldown);
        }
        if self.current == StateId::Heating && matches!(event, Event::EmergencyShutoff) {
            return Some(StateId::SafeLockout);
        }
        if self.current == StateId::Cooling && matches!(event, Event::OverheatAlert) {
            return Some(StateId::Cooldown);
        }
        if self.current == StateId::Cooling && matches!(event, Event::EmergencyShutoff) {
            return Some(StateId::SafeLockout);
        }
        if self.current == StateId::Cooldown && matches!(event, Event::EmergencyShutoff) {
            return Some(StateId::SafeLockout);
        }
        if self.current == StateId::Standby && matches!(event, Event::Tick) && (globals.current_temp_c < globals.target_temp_c - globals.hysteresis_c) {
            return Some(StateId::Heating);
        }
        if self.current == StateId::Heating && matches!(event, Event::Tick) && (globals.current_temp_c >= globals.target_temp_c + globals.hysteresis_c) {
            return Some(StateId::Standby);
        }
        if self.current == StateId::Cooling && matches!(event, Event::Tick) && (globals.current_temp_c <= globals.target_temp_c - globals.hysteresis_c) {
            return Some(StateId::Standby);
        }
        if self.current == StateId::Cooldown && matches!(event, Event::Tick) && (globals.cycle_ticks == 0) {
            return Some(StateId::Standby);
        }
        if self.current == StateId::SafeLockout && matches!(event, Event::Reset) {
            return Some(StateId::Standby);
        }
        if self.current == StateId::Standby && matches!(event, Event::Tick) && (globals.current_temp_c > globals.target_temp_c + globals.hysteresis_c) {
            return Some(StateId::Cooling);
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
            StateId::Standby => states::standby::on_event(&mut self.globals, &current_ev),
            StateId::Heating => states::heating::on_event(&mut self.globals, &current_ev),
            StateId::Cooling => states::cooling::on_event(&mut self.globals, &current_ev),
            StateId::Cooldown => states::cooldown::on_event(&mut self.globals, &current_ev),
            StateId::SafeLockout => states::safe_lockout::on_event(&mut self.globals, &current_ev),
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
