use microclaw_device::pipeline::{TouchEventFrame, TouchPipeline};
use microclaw_protocol::{TouchEventPayload, TouchPhase};

#[test]
fn pipeline_rejects_out_of_bounds_and_drops_oldest_when_full() {
    let mut pipeline = TouchPipeline::new();

    pipeline.push_event(TouchEventPayload {
        pointer_id: 1,
        phase: TouchPhase::Down,
        x: 10,
        y: 10,
        pressure: None,
        raw_timestamp_ms: None,
    });
    assert_eq!(pipeline.queue_depth(), 1);
    assert_eq!(pipeline.next_frame(), None);

    for i in 0..40 {
        pipeline.push_event(TouchEventPayload {
            pointer_id: 1,
            phase: TouchPhase::Down,
            x: 180,
            y: 180,
            pressure: None,
            raw_timestamp_ms: Some(i as u64),
        });
    }

    assert!(pipeline.queue_depth() <= 32);
    assert!(pipeline.dropped_count() > 0);
    assert!(matches!(
        pipeline.next_frame(),
        Some(TouchEventFrame {
            point: _,
            phase: TouchPhase::Down
        })
    ));
}

#[test]
fn pipeline_returns_frames_in_fifo_order() {
    let mut pipeline = TouchPipeline::new();
    pipeline.push_event(TouchEventPayload {
        pointer_id: 2,
        phase: TouchPhase::Down,
        x: 178,
        y: 182,
        pressure: Some(700),
        raw_timestamp_ms: None,
    });
    pipeline.push_event(TouchEventPayload {
        pointer_id: 2,
        phase: TouchPhase::Move,
        x: 182,
        y: 184,
        pressure: Some(512),
        raw_timestamp_ms: None,
    });

    let first = pipeline.next_frame().expect("first frame");
    assert_eq!(first.phase, TouchPhase::Down);
    assert_eq!(first.point.x, 178);
    assert_eq!(first.point.y, 182);
    assert_eq!(
        pipeline.next_frame().expect("second frame").phase,
        TouchPhase::Move
    );
}

#[cfg(not(feature = "esp"))]
#[test]
fn pipeline_drains_host_touch_driver_events() {
    let mut pipeline = TouchPipeline::new();
    let mut driver = microclaw_device::drivers::host::HostTouchDriver::new();

    driver.push_payload(TouchEventPayload {
        pointer_id: 1,
        phase: microclaw_protocol::TouchPhase::Down,
        x: 180,
        y: 150,
        pressure: None,
        raw_timestamp_ms: None,
    });

    let drained = pipeline.drain_from_driver(&mut driver);
    assert_eq!(drained, 1);
    assert_eq!(pipeline.queue_depth(), 1);
    assert_eq!(
        pipeline.next_frame().expect("frame").point,
        microclaw_device::display::DisplayPoint { x: 180, y: 150 }
    );
}
