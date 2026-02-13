use microclaw_device::{protocol::*, RuntimeAction, RuntimeMode, RuntimeState};
use microclaw_protocol::TouchEventPayload;
use serde_json::json;

#[test]
fn accepts_hello_ack_and_moves_connected() {
    let mut state = RuntimeState::new();
    let msg = TransportMessage {
        envelope: Envelope::new("host", "microclaw-device", "boot", MessageId::new("m1")),
        kind: MessageKind::HelloAck,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(0),
        signature: None,
        nonce: None,
        payload: json!({}),
    };

    let action = state.apply_transport_message(&msg);
    assert!(matches!(state.mode(), RuntimeMode::Connected));
    assert!(matches!(
        action,
        RuntimeAction::RaiseUiState {
            message: "connected"
        }
    ));
}

#[test]
fn command_frames_are_created_with_in_flight_tracking() {
    let mut state = RuntimeState::new();
    let cmd = state.emit_command(DeviceAction::StatusGet);
    assert_eq!(cmd.kind, MessageKind::Command);
    assert_eq!(state.in_flight_count(), 1);
    assert!(cmd.corr_id.is_some());
}

#[test]
fn duplicate_message_ids_are_rejected() {
    let mut state = RuntimeState::new();
    let mut msg = TransportMessage {
        envelope: Envelope::new("host", "microclaw-device", "boot", MessageId::new("dup-1")),
        kind: MessageKind::StatusDelta,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(0),
        signature: None,
        nonce: None,
        payload: json!({"connected":true}),
    };

    let first = state.apply_transport_message(&msg);
    assert!(matches!(
        first,
        RuntimeAction::RaiseUiState {
            message: "status_updated"
        }
    ));

    msg.envelope.seq = msg.envelope.seq.max(2);
    let second = state.apply_transport_message(&msg);
    assert!(matches!(
        second,
        RuntimeAction::RaiseUiState {
            message: "replay_or_duplicate_rejected"
        }
    ));
}

#[test]
fn touch_events_drive_scene_action() {
    let mut state = RuntimeState::new();

    let offscreen = TouchEventPayload {
        phase: microclaw_protocol::TouchPhase::Down,
        pointer_id: 1,
        x: 1,
        y: 1,
        pressure: None,
        raw_timestamp_ms: None,
    };
    assert!(matches!(
        state.apply_touch_event(&offscreen),
        RuntimeAction::None
    ));

    let on_screen = TouchEventPayload {
        phase: microclaw_protocol::TouchPhase::Down,
        pointer_id: 1,
        x: 150,
        y: 300,
        pressure: None,
        raw_timestamp_ms: None,
    };
    assert!(matches!(
        state.apply_touch_event(&on_screen),
        RuntimeAction::EmitCommand {
            action: microclaw_protocol::DeviceAction::Retry
        }
    ));
}

#[test]
fn status_snapshot_updates_wifi_state_and_mode() {
    let mut state = RuntimeState::new();
    let status = TransportMessage {
        envelope: Envelope::new(
            "host",
            "microclaw-device",
            "boot",
            MessageId::new("status-1"),
        ),
        kind: MessageKind::StatusSnapshot,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(0),
        signature: None,
        nonce: None,
        payload: json!({
            "wifi_ok": true,
            "host_reachable": true,
            "mode": "ready",
            "scene": "connected",
            "ota_state": "active"
        }),
    };

    let action = state.apply_transport_message(&status);
    assert!(matches!(
        action,
        RuntimeAction::RaiseUiState {
            message: "status_updated"
        }
    ));
    assert_eq!(state.status().mode.as_deref(), Some("ready"));
    assert_eq!(state.status().ota_state.as_deref(), Some("active"));
}

#[test]
fn unauthorized_host_messages_increment_safety_and_deny() {
    let mut state = RuntimeState::with_host_allowlist(["trusted-host"]);
    let status = TransportMessage {
        envelope: Envelope::new("evil-host", "microclaw-device", "boot", MessageId::new("x")),
        kind: MessageKind::HostCommand,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(0),
        signature: None,
        nonce: None,
        payload: json!({"action":"restart"}),
    };

    let action = state.apply_transport_message(&status);
    assert!(matches!(
        action,
        RuntimeAction::RaiseUiState {
            message: "command_denied_unauthorized_source"
        }
    ));
    assert_eq!(state.safety_fail_count(), 1);
    assert!(!state.safety_lockdown_check());
}

#[test]
fn ota_start_marks_ota_in_progress() {
    let mut state = RuntimeState::new();
    let cmd = TransportMessage {
        envelope: Envelope::new("host", "microclaw-device", "boot", MessageId::new("ota-1")),
        kind: MessageKind::Command,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(0),
        signature: None,
        nonce: None,
        payload: json!({
            "action":"ota_start",
            "args":{"version":"1.2.3"}
        }),
    };

    let action = state.apply_transport_message(&cmd);
    assert!(matches!(
        action,
        RuntimeAction::RaiseUiState {
            message: "command_ota_start"
        }
    ));
    assert!(state.ota_in_progress());
    assert_eq!(state.ota_target_version(), Some("1.2.3"));
}

#[test]
fn stale_heartbeat_marks_offline_after_timeout() {
    let mut state = RuntimeState::new();
    state.apply_transport_message(&TransportMessage {
        envelope: Envelope::new(
            "host",
            "microclaw-device",
            "boot",
            MessageId::new("connect"),
        ),
        kind: MessageKind::HelloAck,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(0),
        signature: None,
        nonce: None,
        payload: json!({}),
    });

    state.apply_transport_message(&TransportMessage {
        envelope: Envelope::new("host", "microclaw-device", "boot", MessageId::new("hb")),
        kind: MessageKind::Heartbeat,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(10),
        signature: None,
        nonce: None,
        payload: json!({}),
    });

    assert!(!state.mark_offline_if_stale(50, 100));
    assert!(matches!(
        state.mode(),
        microclaw_device::RuntimeMode::Connected
    ));

    assert!(state.mark_offline_if_stale(200, 100));
    assert!(matches!(
        state.mode(),
        microclaw_device::RuntimeMode::Offline
    ));
}
