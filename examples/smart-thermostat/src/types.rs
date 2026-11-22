//! Generated shared types from WebGME StateMachine: SmartThermostat
//! Do not hand-edit — regenerate from Rusty Studio.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateId {
    Standby,
    Heating,
    Cooling,
    Cooldown,
    SafeLockout,
}

impl StateId {
    pub fn as_str(&self) -> &'static str {
        match self {
            StateId::Standby => "Standby",
            StateId::Heating => "Heating",
            StateId::Cooling => "Cooling",
            StateId::Cooldown => "Cooldown",
            StateId::SafeLockout => "SafeLockout",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Tick,
    SetTarget(f64),
    SetAmbient(f64),
    ToggleEco,
    OverheatAlert,
    EmergencyShutoff,
    Reset,
}

impl Event {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "Tick" => Some(Event::Tick),
            s if s.starts_with("SetTarget:") => s["SetTarget:".len()..].parse::<f64>().ok().map(Event::SetTarget),
            s if s.starts_with("SetAmbient:") => s["SetAmbient:".len()..].parse::<f64>().ok().map(Event::SetAmbient),
            "ToggleEco" => Some(Event::ToggleEco),
            "OverheatAlert" => Some(Event::OverheatAlert),
            "EmergencyShutoff" => Some(Event::EmergencyShutoff),
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
    pub current_temp_c: f64,
    pub target_temp_c: f64,
    pub hysteresis_c: f64,
    pub ambient_temp_c: f64,
    pub energy_wh: f64,
    pub cycle_ticks: u32,
    pub max_cycle_ticks: u32,
    pub fault_code: i32,
    pub eco_mode: bool,
    pub status_note: String,
}

impl Default for Globals {
    fn default() -> Self {
        Self {
            current_temp_c: 21.0,
            target_temp_c: 22.0,
            hysteresis_c: 1.0,
            ambient_temp_c: 15.0,
            energy_wh: 0.0,
            cycle_ticks: 0,
            max_cycle_ticks: 10,
            fault_code: 0,
            eco_mode: false,
            status_note: String::from("Standby"),
        }
    }
}

impl Globals {
    pub fn to_json(&self) -> String {
        let parts = [
            format!("\"current_temp_c\":{}", self.current_temp_c),
            format!("\"target_temp_c\":{}", self.target_temp_c),
            format!("\"hysteresis_c\":{}", self.hysteresis_c),
            format!("\"ambient_temp_c\":{}", self.ambient_temp_c),
            format!("\"energy_wh\":{}", self.energy_wh),
            format!("\"cycle_ticks\":{}", self.cycle_ticks),
            format!("\"max_cycle_ticks\":{}", self.max_cycle_ticks),
            format!("\"fault_code\":{}", self.fault_code),
            format!("\"eco_mode\":{}", self.eco_mode),
            format!("\"status_note\":\"{}\"", self.status_note.replace('"', "\\\""))
        ];
        format!("{{{}}}", parts.join(","))
    }
}
