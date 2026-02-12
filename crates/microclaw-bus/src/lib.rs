use std::collections::HashSet;

use microclaw_protocol::Envelope;

pub struct Bus {
    seen: HashSet<String>,
}

impl Bus {
    pub fn new() -> Self {
        Self { seen: HashSet::new() }
    }

    pub fn publish(&mut self, env: Envelope) -> bool {
        let key = format!("{}:{:?}", env.device_id, env.message_id);
        if self.seen.contains(&key) {
            return false;
        }
        self.seen.insert(key);
        true
    }
}
