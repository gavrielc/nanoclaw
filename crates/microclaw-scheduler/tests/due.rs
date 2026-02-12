use microclaw_scheduler::{Scheduler, TaskSpec};
use std::time::{Duration, SystemTime};

#[test]
fn returns_due_tasks() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(10);
    let mut sched = Scheduler::new();
    sched.add(TaskSpec::once("t1", SystemTime::UNIX_EPOCH));
    let due = sched.due(now);
    assert_eq!(due.len(), 1);
}
