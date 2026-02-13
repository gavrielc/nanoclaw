use httpmock::prelude::*;
use microclaw_connectors::{TelegramConnector, TelegramMessage, TelegramUpdate};

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
    assert_eq!(
        updates,
        vec![TelegramUpdate { update_id: 11 }]
    );
    mock.assert();
}
