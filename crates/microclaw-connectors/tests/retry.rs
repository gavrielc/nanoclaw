use microclaw_connectors::{dedupe_by_id, retry_with_backoff, IdempotencyStore, RetryPolicy};

#[test]
fn retry_with_backoff_retries_until_success() {
    let mut calls = 0;
    let policy = RetryPolicy::new(3, 50);
    let result = retry_with_backoff(policy, |attempt| {
        calls += 1;
        if attempt < 3 {
            Err("fail".to_string())
        } else {
            Ok("ok")
        }
    })
    .unwrap();
    assert_eq!(result, "ok");
    assert_eq!(calls, 3);
}

#[test]
fn retry_with_backoff_returns_error_and_delays() {
    let policy = RetryPolicy::new(3, 10);
    let err = retry_with_backoff::<(), _>(policy, |_| Err("nope".to_string())).unwrap_err();
    assert_eq!(err.attempts, 3);
    assert_eq!(err.delays, vec![10, 20]);
    assert_eq!(err.last_error, "nope");
}

#[test]
fn dedupe_by_id_filters_duplicates() {
    let mut store = IdempotencyStore::new();
    let items = vec!["a".to_string(), "b".to_string(), "a".to_string()];
    let output = dedupe_by_id(&mut store, items, |v| v.clone());
    assert_eq!(output, vec!["a".to_string(), "b".to_string()]);
}
