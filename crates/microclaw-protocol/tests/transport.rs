use microclaw_protocol::{
    DeviceAction, Envelope, MessageId, MessageKind, TouchEventPayload, TransportMessage,
};

#[test]
fn transport_message_expires() {
    let message = TransportMessage {
        envelope: Envelope::new("host", "dev1", "sess", MessageId::new("m1")),
        kind: MessageKind::Heartbeat,
        corr_id: None,
        ttl_ms: Some(100),
        issued_at: Some(0),
        signature: None,
        nonce: None,
        payload: serde_json::Value::Null,
    };

    assert!(message.is_expired(200));
    assert!(!message.is_expired(50));
}

#[test]
fn message_kind_roundtrip() {
    let serialized = serde_json::json!({"v":1,"seq":1,"source":"host","device_id":"d","session_id":"s","message_id":"m","kind":"command"});
    let parsed: TransportMessage = serde_json::from_value(serialized).unwrap();
    assert_eq!(parsed.kind, MessageKind::Command);
    assert_eq!(parsed.envelope.seq, 1);
}

#[test]
fn can_parse_device_command_payload() {
    let frame = TransportMessage {
        envelope: Envelope::new("host", "d", "s", MessageId::new("c1")),
        kind: MessageKind::Command,
        corr_id: None,
        ttl_ms: None,
        issued_at: None,
        signature: None,
        nonce: None,
        payload: serde_json::json!({
            "action": "reconnect",
            "args": {"source":"host"}
        }),
    };

    let command = frame
        .as_device_command()
        .expect("command payload should parse");
    assert_eq!(command.action, DeviceAction::Reconnect);
    assert_eq!(command.args["source"], "host");
}

#[test]
fn can_parse_touch_event_payload() {
    let frame = TransportMessage {
        envelope: Envelope::new("touch", "d", "s", MessageId::new("t1")),
        kind: MessageKind::TouchEvent,
        corr_id: None,
        ttl_ms: None,
        issued_at: None,
        signature: None,
        nonce: None,
        payload: serde_json::json!({
            "phase":"down",
            "x":12,
            "y":34,
            "pointer_id":1,
            "pressure":512
        }),
    };

    let touch: TouchEventPayload = frame.as_touch_event().expect("touch payload should parse");
    assert_eq!(touch.x, 12);
    assert_eq!(touch.y, 34);
    assert_eq!(touch.pressure, Some(512));
    assert_eq!(touch.pointer_id, 1);
}
