use httpmock::prelude::*;
use microclaw_connectors::{
    IdempotencyStore, RetryPolicy, TelegramConnector, TelegramMessage, TelegramUpdate,
};

#[test]
fn telegram_send_message_posts_json() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(POST)
            .path("/botTOKEN/sendMessage")
            .json_body_obj(&serde_json::json!({"chat_id": "123", "text": "hi"}));
        then.status(200).json_body_obj(&serde_json::json!({
            "ok": true,
            "result": {"message_id": 1, "text": "hi"}
        }));
    });

    let base = server.url("");
    let message = TelegramConnector::send_message(&base, "TOKEN", "123", "hi").unwrap();
    assert_eq!(
        message,
        TelegramMessage {
            message_id: 1,
            text: "hi".to_string()
        }
    );
    mock.assert();
}

#[test]
fn telegram_get_updates_uses_offset() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(GET)
            .path("/botTOKEN/getUpdates")
            .query_param("offset", "10");
        then.status(200).json_body_obj(&serde_json::json!({
            "ok": true,
            "result": [{"update_id": 11}]
        }));
    });

    let base = server.url("");
    let updates = TelegramConnector::get_updates(&base, "TOKEN", Some(10)).unwrap();
    assert_eq!(updates, vec![TelegramUpdate { update_id: 11 }]);
    mock.assert();
}

#[test]
fn telegram_send_message_with_retry_retries() {
    let server = MockServer::start();
    let first = server.mock(|when, then| {
        when.method(POST)
            .path("/botTOKEN/sendMessage")
            .header("X-Retry-Stage", "first");
        then.status(500).body("oops");
    });
    let second = server.mock(|when, then| {
        when.method(POST)
            .path("/botTOKEN/sendMessage")
            .header("X-Retry-Stage", "second")
            .json_body_obj(&serde_json::json!({"chat_id": "123", "text": "hi"}));
        then.status(200).json_body_obj(&serde_json::json!({
            "ok": true,
            "result": {"message_id": 2, "text": "hi"}
        }));
    });

    let base = server.url("");
    let policy = RetryPolicy::new(3, 1);
    let message =
        TelegramConnector::send_message_with_retry(&base, "TOKEN", "123", "hi", policy).unwrap();
    assert_eq!(message.message_id, 2);
    first.assert();
    second.assert();
}

#[test]
fn telegram_dedupe_updates_filters_seen() {
    let mut store = IdempotencyStore::new();
    let updates = vec![
        TelegramUpdate { update_id: 1 },
        TelegramUpdate { update_id: 1 },
    ];
    let deduped = TelegramConnector::dedupe_updates(&mut store, updates);
    assert_eq!(deduped.len(), 1);
}
