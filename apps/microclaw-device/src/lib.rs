pub fn boot_message() -> &'static str {
    "microclaw-device ready"
}

pub fn device_ws_url(host: &str, device_id: &str) -> String {
    format!("wss://{}/ws?device_id={}", host, device_id)
}

pub fn reconnect_backoff_ms(attempt: u32) -> u64 {
    let attempt = attempt.max(1) as u64;
    let backoff = 500u64.saturating_mul(1 << (attempt - 1).min(5));
    backoff.min(30_000)
}

pub fn ui_shell_title() -> &'static str {
    "microclaw"
}
