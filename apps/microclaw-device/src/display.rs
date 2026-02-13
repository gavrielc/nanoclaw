//! Display geometry helpers used by host-mode UI/tests.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DisplayPoint {
    pub x: u16,
    pub y: u16,
}

pub const DISPLAY_WIDTH: u16 = 360;
pub const DISPLAY_HEIGHT: u16 = 360;
pub const SAFE_CENTER_X: u16 = DISPLAY_WIDTH / 2;
pub const SAFE_CENTER_Y: u16 = DISPLAY_HEIGHT / 2;
pub const SAFE_RADIUS: u16 = 160;

/// Project a raw touch sample into a usable 360x360 coordinate.
/// Returns `None` when the point is outside the usable circular viewport.
pub fn clamp_and_validate_touch(raw_x: u16, raw_y: u16) -> Option<DisplayPoint> {
    let x = raw_x.min(DISPLAY_WIDTH.saturating_sub(1));
    let y = raw_y.min(DISPLAY_HEIGHT.saturating_sub(1));
    if in_safe_circle(x, y) {
        Some(DisplayPoint { x, y })
    } else {
        None
    }
}

fn in_safe_circle(x: u16, y: u16) -> bool {
    let dx = i32::from(x) - i32::from(SAFE_CENTER_X);
    let dy = i32::from(y) - i32::from(SAFE_CENTER_Y);
    dx * dx + dy * dy <= i32::from(SAFE_RADIUS) * i32::from(SAFE_RADIUS)
}
