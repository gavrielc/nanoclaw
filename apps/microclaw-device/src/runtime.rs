use std::cell::Cell;
use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

use microclaw_protocol::{
    DeviceAction, DeviceStatus, Envelope, MessageId, MessageKind, TouchEventPayload,
    TransportMessage,
};
use serde_json::json;

use crate::display::DisplayPoint;
use crate::ui::Scene;

const DEFAULT_SAFETY_RETRIES: u32 = 5;

#[derive(Clone, Debug, PartialEq)]
pub enum RuntimeMode {
    Booting,
    Connected,
    Offline,
    Error(String),
    SafeMode(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum RuntimeAction {
    None,
    EmitAck {
        corr_id: String,
        status: &'static str,
    },
    EmitCommand {
        action: DeviceAction,
    },
    RaiseUiState {
        message: &'static str,
    },
}

#[derive(Clone, Debug)]
pub struct InFlightCommand {
    pub corr_id: String,
    pub action: DeviceAction,
    pub enqueued_at_ms: u64,
}

#[derive(Clone, Debug)]
pub struct RuntimeState {
    mode: RuntimeMode,
    last_seq: u64,
    seen_message_ids: HashMap<String, u64>,
    in_flight: HashMap<String, InFlightCommand>,
    diagnostics: VecDeque<String>,
    last_status: DeviceStatus,
    offline_since_ms: Option<u64>,
    last_heartbeat_ms: Option<u64>,
    host_allowlist: Vec<String>,
    safety_fail_count: u32,
    safety_fail_limit: u32,
    ota_in_progress: bool,
    ota_target_version: Option<String>,
    ota_error_reason: Option<String>,
    scene_cache: Cell<Scene>,
}

impl RuntimeState {
    pub fn new() -> Self {
        Self {
            mode: RuntimeMode::Booting,
            last_seq: 0,
            seen_message_ids: HashMap::new(),
            in_flight: HashMap::new(),
            diagnostics: VecDeque::new(),
            last_status: DeviceStatus::default(),
            offline_since_ms: None,
            last_heartbeat_ms: None,
            host_allowlist: Vec::new(),
            safety_fail_count: 0,
            safety_fail_limit: DEFAULT_SAFETY_RETRIES,
            ota_in_progress: false,
            ota_target_version: None,
            ota_error_reason: None,
            scene_cache: Cell::new(Scene::Boot),
        }
    }

    pub fn with_host_allowlist(hosts: impl IntoIterator<Item = impl Into<String>>) -> Self {
        let mut state = Self::new();
        state.host_allowlist = hosts.into_iter().map(Into::into).collect();
        state
    }

    pub fn mode(&self) -> &RuntimeMode {
        &self.mode
    }

    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }

    pub fn in_flight_count(&self) -> usize {
        self.in_flight.len()
    }

    pub fn diagnostics(&self) -> &VecDeque<String> {
        &self.diagnostics
    }

    pub fn offline_since_ms(&self) -> Option<u64> {
        self.offline_since_ms
    }

    pub fn safety_fail_count(&self) -> u32 {
        self.safety_fail_count
    }

    pub fn ota_in_progress(&self) -> bool {
        self.ota_in_progress
    }

    pub fn ota_target_version(&self) -> Option<&str> {
        self.ota_target_version.as_deref()
    }

    pub fn ota_error_reason(&self) -> Option<&str> {
        self.ota_error_reason.as_deref()
    }

    pub fn scene(&self) -> Scene {
        let scene = match &self.mode {
            RuntimeMode::Booting => Scene::Boot,
            RuntimeMode::Connected => Scene::Paired,
            RuntimeMode::Offline => Scene::Offline,
            RuntimeMode::Error(_) => Scene::Error,
            RuntimeMode::SafeMode(_) => Scene::Settings,
        };
        self.scene_cache.set(scene);
        scene
    }

    pub fn status(&self) -> &DeviceStatus {
        &self.last_status
    }

    pub fn is_host_allowed(&self, source: &str) -> bool {
        if self.host_allowlist.is_empty() {
            return true;
        }
        self.host_allowlist
            .iter()
            .any(|allowed| allowed == source || allowed == "*")
    }

    pub fn process_touch(&mut self, point: DisplayPoint) -> RuntimeAction {
        let action = self.scene().action_for_touch(point);
        match action {
            Some(action) => RuntimeAction::EmitCommand { action },
            None => RuntimeAction::None,
        }
    }

    pub fn apply_touch_event(&mut self, event: &TouchEventPayload) -> RuntimeAction {
        match event.phase {
            microclaw_protocol::TouchPhase::Up | microclaw_protocol::TouchPhase::Cancel => {
                RuntimeAction::None
            }
            microclaw_protocol::TouchPhase::Down
            | microclaw_protocol::TouchPhase::Move
            | microclaw_protocol::TouchPhase::Unknown => {
                if let Some(point) = crate::display::clamp_and_validate_touch(event.x, event.y) {
                    self.process_touch(point)
                } else {
                    RuntimeAction::None
                }
            }
        }
    }

    pub fn apply_transport_message(&mut self, msg: &TransportMessage) -> RuntimeAction {
        if !self.is_host_allowed(msg.envelope.source.as_str()) {
            self.safety_fail_count = self.safety_fail_count.saturating_add(1);
            return RuntimeAction::RaiseUiState {
                message: "command_denied_unauthorized_source",
            };
        }

        if self.is_duplicate_or_stale(msg.envelope.seq, &msg.envelope.message_id) {
            return RuntimeAction::RaiseUiState {
                message: "replay_or_duplicate_rejected",
            };
        }

        self.last_seq = msg.envelope.seq;
        self.track_message_id(msg.envelope.seq, &msg.envelope.message_id);
        self.note_heartbeat(msg.issued_at);

        match &msg.kind {
            MessageKind::HelloAck => {
                self.mode = RuntimeMode::Connected;
                self.offline_since_ms = None;
                self.safety_fail_count = 0;
                RuntimeAction::RaiseUiState {
                    message: "connected",
                }
            }
            MessageKind::StatusDelta | MessageKind::StatusSnapshot => {
                if let Some(status) = msg.as_status_snapshot() {
                    self.apply_status_snapshot(status);
                }
                self.offline_since_ms = None;
                RuntimeAction::RaiseUiState {
                    message: "status_updated",
                }
            }
            MessageKind::Command | MessageKind::HostCommand => match msg.as_device_command() {
                Some(command) => match command.action {
                    DeviceAction::Reconnect => {
                        self.mode = RuntimeMode::Offline;
                        RuntimeAction::RaiseUiState {
                            message: "command_reconnect",
                        }
                    }
                    DeviceAction::Retry => {
                        self.mode = RuntimeMode::Booting;
                        RuntimeAction::RaiseUiState {
                            message: "command_retry",
                        }
                    }
                    DeviceAction::Restart => {
                        self.mode = RuntimeMode::Booting;
                        RuntimeAction::RaiseUiState {
                            message: "command_restart",
                        }
                    }
                    DeviceAction::OtaStart => {
                        self.ota_target_version = command
                            .args
                            .get("version")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_owned());
                        self.ota_error_reason = None;
                        self.ota_in_progress = true;
                        RuntimeAction::RaiseUiState {
                            message: "command_ota_start",
                        }
                    }
                    DeviceAction::DiagnosticsSnapshot => RuntimeAction::RaiseUiState {
                        message: "command_diagnostics",
                    },
                    _ => RuntimeAction::RaiseUiState {
                        message: "command_received",
                    },
                },
                None => RuntimeAction::RaiseUiState {
                    message: "command_parse_error",
                },
            },
            MessageKind::CommandAck => {
                if let Some(corr_id) = msg.corr_id.as_ref() {
                    self.in_flight.remove(corr_id);
                    RuntimeAction::EmitAck {
                        corr_id: corr_id.clone(),
                        status: "command_ack",
                    }
                } else {
                    RuntimeAction::None
                }
            }
            MessageKind::CommandResult => {
                if let Some(corr_id) = msg.corr_id.as_ref() {
                    self.in_flight.remove(corr_id);
                }
                RuntimeAction::RaiseUiState {
                    message: "command_result",
                }
            }
            MessageKind::Error => RuntimeAction::RaiseUiState {
                message: "host_error",
            },
            MessageKind::Heartbeat => {
                self.mode = RuntimeMode::Connected;
                RuntimeAction::None
            }
            _ => RuntimeAction::None,
        }
    }

    pub fn emit_command(&mut self, action: DeviceAction) -> TransportMessage {
        let seq = self.last_seq.saturating_add(1);
        self.last_seq = seq;
        let message_id = MessageId::new(format!("cmd-{seq}"));
        let corr_id = format!("corr-{seq}");
        let envelope = Envelope {
            v: 1,
            seq,
            source: "device".to_owned(),
            device_id: "microclaw-device".to_owned(),
            session_id: "boot".to_owned(),
            message_id,
        };
        self.in_flight.insert(
            corr_id.clone(),
            InFlightCommand {
                corr_id: corr_id.clone(),
                action: action.clone(),
                enqueued_at_ms: now_ms(),
            },
        );

        TransportMessage {
            envelope,
            kind: MessageKind::Command,
            corr_id: Some(corr_id),
            ttl_ms: None,
            issued_at: Some(now_ms()),
            signature: None,
            nonce: None,
            payload: json!({
                "action": action,
            }),
        }
    }

    pub fn mark_offline_with_reason(&mut self, reason: impl Into<String>, now_ms: u64) {
        if !matches!(self.mode, RuntimeMode::Offline) {
            self.mode = RuntimeMode::Offline;
            self.offline_since_ms = Some(now_ms);
            self.push_diagnostic(reason.into());
        }
    }

    pub fn mark_error_with_reason(&mut self, reason: impl Into<String>) {
        self.mode = RuntimeMode::Error(reason.into());
    }

    pub fn mark_offline_if_stale(&mut self, now_ms: u64, heartbeat_timeout_ms: u64) -> bool {
        if matches!(self.mode, RuntimeMode::Offline) {
            return false;
        }
        let last_seen = self.last_heartbeat_ms.unwrap_or_else(|| now_ms);
        if now_ms.saturating_sub(last_seen) > heartbeat_timeout_ms {
            self.mark_offline_with_reason("heartbeat_stale", now_ms);
            true
        } else {
            false
        }
    }

    pub fn safety_lockdown_check(&mut self) -> bool {
        if matches!(self.mode, RuntimeMode::SafeMode(_)) {
            return false;
        }
        if self.safety_fail_count >= self.safety_fail_limit {
            self.mode =
                RuntimeMode::SafeMode("safety_retries_exhausted_entering_safe_mode".to_owned());
            true
        } else {
            false
        }
    }

    #[cfg(test)]
    pub fn note_last_heartbeat_for_tests(&mut self, issued_at: u64) {
        self.last_heartbeat_ms = Some(issued_at);
    }

    pub fn mark_ota_complete(&mut self, success: bool, reason: Option<String>) -> RuntimeAction {
        self.ota_in_progress = false;
        self.ota_error_reason = reason.clone();
        if success {
            self.last_status.ota_state = Some("active".to_owned());
            RuntimeAction::RaiseUiState {
                message: "ota_complete",
            }
        } else {
            self.last_status.ota_state = Some("failed".to_owned());
            RuntimeAction::RaiseUiState {
                message: "ota_failed",
            }
        }
    }

    fn apply_status_snapshot(&mut self, status: DeviceStatus) {
        self.last_status = status.clone();
        if !status.wifi_ok {
            self.mark_offline_with_reason("status_wifi_not_ok", now_ms());
            return;
        }

        if let Some(mode) = status.mode.as_deref() {
            match mode {
                "boot" => self.mode = RuntimeMode::Booting,
                "connected" | "paired" | "ready" => self.mode = RuntimeMode::Connected,
                "offline" => self.mode = RuntimeMode::Offline,
                "safe_mode" => {
                    self.mode = RuntimeMode::SafeMode("host_reported_safe_mode".to_owned())
                }
                "error" => self.mode = RuntimeMode::Error("host_reported_error".to_owned()),
                _ => {}
            }
        }
    }

    fn note_heartbeat(&mut self, issued_at: Option<u64>) {
        self.last_heartbeat_ms = Some(issued_at.unwrap_or_else(now_ms));
    }

    fn is_duplicate_or_stale(&self, seq: u64, message_id: &MessageId) -> bool {
        if seq <= self.last_seq {
            return true;
        }
        self.seen_message_ids.get(message_id.as_str()).is_some()
    }

    fn track_message_id(&mut self, seq: u64, message_id: &MessageId) {
        if self.seen_message_ids.len() > 512 {
            self.seen_message_ids.clear();
        }
        self.seen_message_ids
            .insert(message_id.as_str().to_owned(), seq);
    }

    fn push_diagnostic(&mut self, entry: impl Into<String>) {
        self.diagnostics.push_back(entry.into());
        self.trim_diagnostics();
    }

    fn trim_diagnostics(&mut self) {
        while self.diagnostics.len() > 16 {
            self.diagnostics.pop_front();
        }
    }
}

pub fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(dur) => dur.as_millis() as u64,
        Err(_) => 0,
    }
}
