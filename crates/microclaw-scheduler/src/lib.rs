use chrono::{DateTime, Utc};
use cron::Schedule;
use rusqlite::{params, Connection};
use std::str::FromStr;
use std::time::SystemTime;

pub struct TaskSpec {
    id: String,
    at: SystemTime,
}

impl TaskSpec {
    pub fn once(id: &str, at: SystemTime) -> Self {
        Self {
            id: id.to_string(),
            at,
        }
    }
}

pub struct Scheduler {
    tasks: Vec<TaskSpec>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self { tasks: Vec::new() }
    }

    pub fn add(&mut self, task: TaskSpec) {
        self.tasks.push(task);
    }

    pub fn due(&self, now: SystemTime) -> Vec<&TaskSpec> {
        self.tasks.iter().filter(|t| t.at <= now).collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScheduleType {
    Once,
    Interval,
    Cron,
}

impl ScheduleType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ScheduleType::Once => "once",
            ScheduleType::Interval => "interval",
            ScheduleType::Cron => "cron",
        }
    }
}

#[derive(Debug)]
pub enum SchedulerError {
    InvalidScheduleType(String),
    InvalidScheduleValue(String),
    Cron(String),
}

impl From<cron::error::Error> for SchedulerError {
    fn from(err: cron::error::Error) -> Self {
        SchedulerError::Cron(err.to_string())
    }
}

impl FromStr for ScheduleType {
    type Err = SchedulerError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "once" => Ok(ScheduleType::Once),
            "interval" => Ok(ScheduleType::Interval),
            "cron" => Ok(ScheduleType::Cron),
            other => Err(SchedulerError::InvalidScheduleType(other.to_string())),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ScheduledTask {
    pub id: String,
    pub group_folder: String,
    pub chat_jid: String,
    pub prompt: String,
    pub schedule_type: ScheduleType,
    pub schedule_value: String,
    pub next_run: Option<DateTime<Utc>>,
    pub status: String,
    pub context_mode: String,
}

pub fn compute_next_run(
    schedule_type: ScheduleType,
    schedule_value: &str,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>, SchedulerError> {
    match schedule_type {
        ScheduleType::Interval => {
            let interval_ms: i64 = schedule_value
                .parse()
                .map_err(|_| SchedulerError::InvalidScheduleValue(schedule_value.to_string()))?;
            Ok(now + chrono::Duration::milliseconds(interval_ms))
        }
        ScheduleType::Cron => {
            let schedule = Schedule::from_str(schedule_value)?;
            let next = schedule
                .after(&now)
                .next()
                .ok_or_else(|| SchedulerError::Cron("no upcoming cron times".to_string()))?;
            Ok(next)
        }
        ScheduleType::Once => Err(SchedulerError::InvalidScheduleValue(
            "once schedules do not compute next run".to_string(),
        )),
    }
}

pub fn due_tasks(
    conn: &Connection,
    now: DateTime<Utc>,
) -> rusqlite::Result<Vec<ScheduledTask>> {
    let mut stmt = conn.prepare(
        "SELECT id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, context_mode
         FROM scheduled_tasks
         WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
         ORDER BY next_run ASC",
    )?;
    let now_value = now.to_rfc3339();
    let rows = stmt.query_map([now_value], |row| {
        let schedule_type_raw: String = row.get(4)?;
        let next_run_raw: Option<String> = row.get(6)?;
        let next_run = next_run_raw
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(&value).ok())
            .map(|dt| dt.with_timezone(&Utc));
        Ok(ScheduledTask {
            id: row.get(0)?,
            group_folder: row.get(1)?,
            chat_jid: row.get(2)?,
            prompt: row.get(3)?,
            schedule_type: ScheduleType::from_str(&schedule_type_raw)
                .unwrap_or(ScheduleType::Once),
            schedule_value: row.get(5)?,
            next_run,
            status: row.get(7)?,
            context_mode: row.get(8)?,
        })
    })?;

    let mut tasks = Vec::new();
    for task in rows {
        tasks.push(task?);
    }
    Ok(tasks)
}

pub fn update_task_after_run(
    conn: &Connection,
    id: &str,
    next_run: Option<DateTime<Utc>>,
    last_result: &str,
    last_run: DateTime<Utc>,
) -> rusqlite::Result<()> {
    let next_run_value = next_run.map(|value| value.to_rfc3339());
    conn.execute(
        "UPDATE scheduled_tasks
         SET last_run = ?, last_result = ?, next_run = ?
         WHERE id = ?",
        params![last_run.to_rfc3339(), last_result, next_run_value, id],
    )?;
    Ok(())
}
