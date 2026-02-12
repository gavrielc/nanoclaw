use microclaw_protocol::Envelope;
use rusqlite::{params, Connection};

const BUS_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS bus_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bus_events_msg ON bus_events(device_id, message_id);
CREATE INDEX IF NOT EXISTS idx_bus_events_seq ON bus_events(seq);
"#;

pub struct Bus {
    conn: Connection,
}

impl Bus {
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(BUS_SCHEMA_SQL)?;
        Ok(Self { conn })
    }

    pub fn publish(&mut self, env: Envelope) -> rusqlite::Result<bool> {
        let exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM bus_events WHERE device_id = ? AND message_id = ?",
            params![env.device_id, env.message_id.as_str()],
            |row| row.get(0),
        )?;
        if exists > 0 {
            return Ok(false);
        }
        let payload = serde_json::to_string(&env).expect("serialize envelope");
        self.conn.execute(
            "INSERT INTO bus_events (seq, device_id, session_id, message_id, payload) VALUES (?, ?, ?, ?, ?)",
            params![env.seq as i64, env.device_id, env.session_id, env.message_id.as_str(), payload],
        )?;
        Ok(true)
    }

    pub fn replay_from_seq(&self, after_seq: u64) -> rusqlite::Result<Vec<Envelope>> {
        let mut stmt = self.conn.prepare(
            "SELECT payload FROM bus_events WHERE seq > ? ORDER BY seq ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![after_seq as i64], |row| row.get::<_, String>(0))?;
        let mut events = Vec::new();
        for row in rows {
            let payload = row?;
            let env: Envelope = serde_json::from_str(&payload).expect("deserialize envelope");
            events.push(env);
        }
        Ok(events)
    }
}
