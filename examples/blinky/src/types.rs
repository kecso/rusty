//! Generated shared types from WebGME StateMachine: BlinkyController
//! Do not hand-edit — regenerate from Rusty Studio.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateId {
    Idle,
    LedOn,
    LedOff,
    Fault,
}

impl StateId {
    pub fn as_str(&self) -> &'static str {
        match self {
            StateId::Idle => "Idle",
            StateId::LedOn => "LedOn",
            StateId::LedOff => "LedOff",
            StateId::Fault => "Fault",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Start,
    Tick,
    Stop,
    FaultDetected,
    Reset,
}

impl Event {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "Start" => Some(Event::Start),
            "Tick" => Some(Event::Tick),
            "Stop" => Some(Event::Stop),
            "FaultDetected" => Some(Event::FaultDetected),
            "Reset" => Some(Event::Reset),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Stay,
    Transition(StateId),
    Emit(Event),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Globals {
    pub led_high: bool,
    pub blink_count: u32,
    pub max_blinks: u32,
    pub temperature_c: i32,
}

impl Default for Globals {
    fn default() -> Self {
        Self {
            led_high: false,
            blink_count: 0,
            max_blinks: 5,
            temperature_c: 28,
        }
    }
}

impl Globals {
    pub fn to_json(&self) -> String {
        let parts = [
            format!("\"led_high\":{}", self.led_high),
            format!("\"blink_count\":{}", self.blink_count),
            format!("\"max_blinks\":{}", self.max_blinks),
            format!("\"temperature_c\":{}", self.temperature_c)
        ];
        format!("{{{}}}", parts.join(","))
    }
}
