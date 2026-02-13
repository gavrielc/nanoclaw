use microclaw_queue::{ExecutionQueue, RetryPolicy};

#[test]
fn respects_global_inflight_limit() {
    let mut queue = ExecutionQueue::new(1, RetryPolicy::new(2, 1000));
    queue.enqueue("g1", "t1", "first");
    queue.enqueue("g2", "t2", "second");

    let first = queue.next_ready(0).unwrap();
    assert_eq!(first.id, "t1");
    assert!(queue.next_ready(0).is_none());

    queue.complete(first, true, 0);
    let second = queue.next_ready(0).unwrap();
    assert_eq!(second.id, "t2");
}

#[test]
fn preserves_per_group_serialization() {
    let mut queue = ExecutionQueue::new(2, RetryPolicy::new(2, 1000));
    queue.enqueue("g1", "t1", "first");
    queue.enqueue("g1", "t2", "second");

    let first = queue.next_ready(0).unwrap();
    assert_eq!(first.id, "t1");
    assert!(queue.next_ready(0).is_none());

    queue.complete(first, true, 0);
    let second = queue.next_ready(0).unwrap();
    assert_eq!(second.id, "t2");
}

#[test]
fn retries_failed_item_with_backoff() {
    let mut queue = ExecutionQueue::new(1, RetryPolicy::new(2, 1000));
    queue.enqueue("g1", "t1", "first");

    let attempt1 = queue.next_ready(0).unwrap();
    assert_eq!(attempt1.attempts, 1);
    queue.complete(attempt1, false, 0);

    assert!(queue.next_ready(0).is_none());
    let attempt2 = queue.next_ready(1000).unwrap();
    assert_eq!(attempt2.attempts, 2);
    queue.complete(attempt2, false, 1000);

    assert!(queue.next_ready(2000).is_none());
}
