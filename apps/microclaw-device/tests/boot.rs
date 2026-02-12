#[test]
fn device_boot_message() {
    let msg = microclaw_device::boot_message();
    assert_eq!(msg, "microclaw-device ready");
}
