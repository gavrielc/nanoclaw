use microclaw_device::{display::DisplayPoint, ui::Scene, RuntimeState};
use microclaw_protocol::DeviceAction;

#[test]
fn boot_scene_maps_retry_button() {
    let mut state = RuntimeState::new();
    let touch = DisplayPoint { x: 150, y: 300 };
    let action = state.process_touch(touch);
    assert!(matches!(
        action,
        microclaw_device::RuntimeAction::EmitCommand {
            action: DeviceAction::Retry,
        }
    ));
}

#[test]
fn paired_scene_maps_conversation_card() {
    assert_eq!(
        Scene::Paired.action_for_touch(DisplayPoint { x: 180, y: 150 }),
        Some(DeviceAction::OpenConversation)
    );
    assert_eq!(
        Scene::Paired.action_for_touch(DisplayPoint { x: 10, y: 10 }),
        None
    );
}

#[test]
fn conversation_and_offline_mappings_are_exposed() {
    assert_eq!(
        Scene::Conversation.action_for_touch(DisplayPoint { x: 75, y: 290 }),
        Some(DeviceAction::Mute)
    );
    assert_eq!(
        Scene::Offline.action_for_touch(DisplayPoint { x: 90, y: 268 }),
        Some(DeviceAction::Restart)
    );
}
