use microclaw_device::{device_ws_url, reconnect_backoff_ms, ui_shell_title};

#[test]
fn builds_device_ws_url() {
    let url = device_ws_url("gateway.local", "dev1");
    assert_eq!(url, "wss://gateway.local/ws?device_id=dev1");
}

#[test]
fn reconnect_backoff_increases() {
    let first = reconnect_backoff_ms(1);
    let second = reconnect_backoff_ms(2);
    assert!(second > first);
}

#[test]
fn exposes_ui_shell_title() {
    assert_eq!(ui_shell_title(), "microclaw");
}
