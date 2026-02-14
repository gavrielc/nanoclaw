use microclaw_protocol::DeviceAction;

use crate::display::DisplayPoint;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scene {
    Boot,
    ConnectSetup,
    Paired,
    Conversation,
    AgentThinking,
    AgentStreaming,
    AgentTaskProgress,
    Settings,
    NotificationList,
    Error,
    Offline,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HitTarget {
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
    pub action: DeviceAction,
}

impl HitTarget {
    fn hit(&self, p: DisplayPoint) -> bool {
        p.x >= self.x
            && p.x <= self.x.saturating_add(self.w)
            && p.y >= self.y
            && p.y <= self.y.saturating_add(self.h)
    }
}

impl Scene {
    pub fn action_for_touch(&self, point: DisplayPoint) -> Option<DeviceAction> {
        targets_for_scene(*self)
            .iter()
            .find(|t| t.hit(point))
            .map(|t| t.action.clone())
    }
}

fn targets_for_scene(scene: Scene) -> &'static [HitTarget] {
    match scene {
        Scene::Boot => &[HitTarget {
            x: 126,
            y: 292,
            w: 108,
            h: 46,
            action: DeviceAction::Retry,
        }],
        Scene::ConnectSetup => &[
            HitTarget {
                x: 40,
                y: 280,
                w: 56,
                h: 56,
                action: DeviceAction::WifiReconnect,
            },
            HitTarget {
                x: 110,
                y: 280,
                w: 140,
                h: 56,
                action: DeviceAction::Reconnect,
            },
            HitTarget {
                x: 264,
                y: 280,
                w: 56,
                h: 56,
                action: DeviceAction::StatusGet,
            },
        ],
        Scene::Paired => &[
            HitTarget {
                x: 60,
                y: 130,
                w: 240,
                h: 100,
                action: DeviceAction::OpenConversation,
            },
            HitTarget {
                x: 34,
                y: 250,
                w: 110,
                h: 60,
                action: DeviceAction::Unpair,
            },
            HitTarget {
                x: 216,
                y: 250,
                w: 110,
                h: 60,
                action: DeviceAction::SyncNow,
            },
            HitTarget {
                x: 122,
                y: 320,
                w: 116,
                h: 28,
                action: DeviceAction::WifiReconnect,
            },
        ],
        Scene::Conversation => &[
            HitTarget {
                x: 52,
                y: 280,
                w: 124,
                h: 54,
                action: DeviceAction::Mute,
            },
            HitTarget {
                x: 184,
                y: 280,
                w: 124,
                h: 54,
                action: DeviceAction::EndSession,
            },
            HitTarget {
                x: 108,
                y: 320,
                w: 144,
                h: 30,
                action: DeviceAction::OpenConversation,
            },
        ],
        Scene::AgentThinking | Scene::AgentStreaming | Scene::AgentTaskProgress => &[],
        Scene::Settings => &[HitTarget {
            x: 150,
            y: 320,
            w: 60,
            h: 30,
            action: DeviceAction::StatusGet,
        }],
        Scene::NotificationList => &[],
        Scene::Error | Scene::Offline => &[
            HitTarget {
                x: 86,
                y: 250,
                w: 188,
                h: 64,
                action: DeviceAction::Restart,
            },
            HitTarget {
                x: 80,
                y: 320,
                w: 200,
                h: 40,
                action: DeviceAction::Reconnect,
            },
        ],
    }
}
