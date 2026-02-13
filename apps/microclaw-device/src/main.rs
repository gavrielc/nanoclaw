use microclaw_device::{
    display,
    event_loop::{DeviceEventLoop, EventLoopConfig},
    now_ms,
    pipeline::TouchPipeline,
    renderer::NullRenderer,
    protocol::TouchEventPayload,
    RuntimeState,
};

fn main() {
    println!("{}", microclaw_device::boot_message());
    let mut state = RuntimeState::new();
    let mut loop_state = DeviceEventLoop::new(EventLoopConfig {
        render_interval_ms: 50,
        offline_timeout_ms: 4_000,
    });
    let mut pipeline = TouchPipeline::new();
    let mut renderer = NullRenderer::new();

    if let Some(point) = display::clamp_and_validate_touch(180, 145) {
        pipeline.push_event(TouchEventPayload {
            pointer_id: 1,
            phase: microclaw_device::protocol::TouchPhase::Down,
            x: point.x,
            y: point.y,
            pressure: None,
            raw_timestamp_ms: Some(now_ms()),
        });
    }

    let frame = microclaw_device::protocol::TransportMessage {
        envelope: microclaw_device::protocol::Envelope::new(
            "host",
            "microclaw-device",
            "boot",
            microclaw_device::protocol::MessageId::new("boot-1"),
        ),
        kind: microclaw_device::protocol::MessageKind::HelloAck,
        corr_id: None,
        ttl_ms: None,
        issued_at: Some(now_ms()),
        signature: None,
        nonce: None,
        payload: serde_json::json!({"device":"microclaw-device"}),
    };

    let output = loop_state.step(
        &mut state,
        &mut pipeline,
        std::slice::from_ref(&frame),
        now_ms(),
        &mut renderer,
    );

    println!("runtime scene: {:?}", state.scene());
    println!("runtime mode: {:?}", state.mode());
    println!("runtime action ui events: {:?}", output.ui_messages);
    println!(
        "rendered={}, outbound={}, offline_entered={}",
        output.rendered,
        output.outbound.len(),
        output.offline_entered
    );
    if let Some(cmd) = output.outbound.first() {
        println!(
            "generated command: corr_id={} kind={:?}",
            cmd.corr_id.clone().unwrap_or_default(),
            cmd.kind
        );
    }
}
