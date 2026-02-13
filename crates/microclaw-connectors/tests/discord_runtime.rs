use httpmock::prelude::*;
use microclaw_connectors::{DiscordConnector, DiscordMessage, IdempotencyStore, RetryPolicy};

#[test]
fn discord_send_message_posts_json() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v10/channels/123/messages")
            .header("Authorization", "Bot token")
            .json_body_obj(&serde_json::json!({"content": "hi"}));
        then.status(200)
            .json_body_obj(&serde_json::json!({"id": "1", "content": "hi"}));
    });

    let base = server.url("/api/v10");
    let message = DiscordConnector::send_message(&base, "token", "123", "hi").unwrap();
    assert_eq!(
        message,
        DiscordMessage {
            id: "1".to_string(),
            content: "hi".to_string()
        }
    );
    mock.assert();
}

#[test]
fn discord_fetch_messages_uses_after_param() {
    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v10/channels/123/messages")
            .query_param("after", "10")
            .header("Authorization", "Bot token");
        then.status(200)
            .json_body_obj(&serde_json::json!([{"id": "11", "content": "yo"}]));
    });

    let base = server.url("/api/v10");
    let messages = DiscordConnector::fetch_messages(&base, "token", "123", Some("10")).unwrap();
    assert_eq!(
        messages,
        vec![DiscordMessage {
            id: "11".to_string(),
            content: "yo".to_string()
        }]
    );
    mock.assert();
}

#[test]
fn discord_send_message_with_retry_retries() {
    let server = MockServer::start();
    let first = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v10/channels/123/messages")
            .header("X-Retry-Stage", "first");
        then.status(500).body("oops");
    });
    let second = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v10/channels/123/messages")
            .header("Authorization", "Bot token")
            .header("X-Retry-Stage", "second");
        then.status(200)
            .json_body_obj(&serde_json::json!({"id": "2", "content": "ok"}));
    });

    let base = server.url("/api/v10");
    let policy = RetryPolicy::new(3, 1);
    let message = DiscordConnector::send_message_with_retry(&base, "token", "123", "hi", policy)
        .unwrap();
    assert_eq!(message.id, "2");
    first.assert();
    second.assert();
}

#[test]
fn discord_dedupe_messages_filters_seen() {
    let mut store = IdempotencyStore::new();
    let messages = vec![
        DiscordMessage {
            id: "1".to_string(),
            content: "a".to_string(),
        },
        DiscordMessage {
            id: "1".to_string(),
            content: "a".to_string(),
        },
    ];
    let deduped = DiscordConnector::dedupe_messages(&mut store, messages);
    assert_eq!(deduped.len(), 1);
}
