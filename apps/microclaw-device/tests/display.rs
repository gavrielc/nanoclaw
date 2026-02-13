use microclaw_device::display::*;

#[test]
fn clamp_keeps_in_bounds() {
    assert_eq!(clamp_and_validate_touch(0, 0), None);
    assert_eq!(clamp_and_validate_touch(360, 360), None);
}

#[test]
fn clamp_rejects_outside_circle() {
    assert_eq!(clamp_and_validate_touch(0, 180), None);
    assert_eq!(clamp_and_validate_touch(359, 180), None);
    assert!(clamp_and_validate_touch(180, 0).is_none());
}

#[test]
fn clamp_accepts_central_pixel() {
    assert_eq!(
        clamp_and_validate_touch(180, 180),
        Some(DisplayPoint { x: 180, y: 180 })
    );
}
