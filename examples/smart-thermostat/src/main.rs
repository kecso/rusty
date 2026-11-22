//! CLI trace runner for SmartThermostat.
//! Usage: cargo run -- Start Tick Tick Stop

use smart_thermostat::{Event, StateMachine};

fn main() {
    let mut sm = StateMachine::new();
    let args: Vec<String> = std::env::args().skip(1).collect();

    println!(
        "{{\"step\":0,\"event\":\"__init__\",\"from\":\"{}\",\"to\":\"{}\",\"globals\":{}}}",
        sm.current.as_str(),
        sm.current.as_str(),
        sm.globals.to_json()
    );

    for raw in args {
        match Event::parse(&raw) {
            Some(ev) => {
                let (from, to) = sm.dispatch(&ev);
                println!(
                    "{{\"step\":{},\"event\":\"{}\",\"from\":\"{}\",\"to\":\"{}\",\"globals\":{}}}",
                    sm.step_count,
                    raw.replace('"', "\\\""),
                    from.as_str(),
                    to.as_str(),
                    sm.globals.to_json()
                );
            }
            None => {
                eprintln!("Unknown event: {}", raw);
            }
        }
    }
}
