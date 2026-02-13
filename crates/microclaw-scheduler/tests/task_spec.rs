use microclaw_scheduler::TaskSpec;
use std::time::{Duration, SystemTime};

#[test]
fn task_spec_exposes_id() {
    let task = TaskSpec::once("t1", SystemTime::UNIX_EPOCH + Duration::from_secs(1));
    assert_eq!(task.id(), "t1");
}
