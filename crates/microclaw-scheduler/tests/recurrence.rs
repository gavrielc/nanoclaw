use chrono::{TimeZone, Utc};
use microclaw_scheduler::{compute_next_run, due_tasks, update_task_after_run, ScheduleType};
use microclaw_store::Store;

#[test]
fn computes_next_run_for_interval() {
    let now = Utc.with_ymd_and_hms(2026, 2, 12, 0, 0, 0).unwrap();
    let next = compute_next_run(ScheduleType::Interval, "60000", now).unwrap();
    assert_eq!(next, now + chrono::Duration::milliseconds(60000));
}

#[test]
fn computes_next_run_for_cron() {
    let now = Utc.with_ymd_and_hms(2026, 2, 12, 10, 0, 0).unwrap();
    let next = compute_next_run(ScheduleType::Cron, "0 0 11 * * *", now).unwrap();
    assert_eq!(next, Utc.with_ymd_and_hms(2026, 2, 12, 11, 0, 0).unwrap());
}

#[test]
fn due_tasks_filters_active_by_next_run() {
    let store = Store::open_in_memory().unwrap();
    let conn = store.conn();
    conn.execute(
        "INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at, context_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "t1",
            "g1",
            "jid1",
            "prompt",
            "interval",
            "60000",
            "2026-02-12T00:00:00Z",
            "active",
            "2026-02-12T00:00:00Z",
            "isolated",
        ),
    )
    .unwrap();

    let now = Utc.with_ymd_and_hms(2026, 2, 12, 0, 0, 1).unwrap();
    let due = due_tasks(conn, now).unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, "t1");
}

#[test]
fn update_task_after_run_persists_next_run() {
    let store = Store::open_in_memory().unwrap();
    let conn = store.conn();
    conn.execute(
        "INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at, context_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "t2",
            "g1",
            "jid1",
            "prompt",
            "interval",
            "60000",
            "2026-02-12T00:00:00Z",
            "active",
            "2026-02-12T00:00:00Z",
            "isolated",
        ),
    )
    .unwrap();

    let last_run = Utc.with_ymd_and_hms(2026, 2, 12, 0, 0, 0).unwrap();
    let next_run = last_run + chrono::Duration::milliseconds(60000);
    update_task_after_run(conn, "t2", Some(next_run), "ok", last_run).unwrap();

    let stored: Option<String> = conn
        .query_row(
            "SELECT next_run FROM scheduled_tasks WHERE id = ?",
            ["t2"],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored.unwrap(), "2026-02-12T00:01:00+00:00");
}
