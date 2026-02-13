use microclaw_connectors::imap_idle_timeout_secs;

#[test]
fn idle_timeout_is_bounded() {
    assert!(imap_idle_timeout_secs() <= 60);
}
