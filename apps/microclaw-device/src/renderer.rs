use crate::drivers::{DisplayDriver, Rect};
use crate::runtime::RuntimeState;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenderStats {
    pub frames_requested: u64,
    pub scenes_rendered: u64,
}

impl RenderStats {
    pub fn new() -> Self {
        Self {
            frames_requested: 0,
            scenes_rendered: 0,
        }
    }
}

impl Default for RenderStats {
    fn default() -> Self {
        Self::new()
    }
}

pub trait SceneRenderer {
    fn render(&mut self, state: &RuntimeState, now_ms: u64) -> bool;
    fn stats(&self) -> &RenderStats;
}

pub struct NullRenderer {
    current_scene: Option<crate::ui::Scene>,
    stats_: RenderStats,
}

impl NullRenderer {
    pub fn new() -> Self {
        Self {
            current_scene: None,
            stats_: RenderStats::new(),
        }
    }
}

impl Default for NullRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl SceneRenderer for NullRenderer {
    fn render(&mut self, state: &RuntimeState, _now_ms: u64) -> bool {
        self.stats_.frames_requested = self.stats_.frames_requested.saturating_add(1);
        let target = state.scene();
        if self.current_scene != Some(target) {
            self.current_scene = Some(target);
            self.stats_.scenes_rendered = self.stats_.scenes_rendered.saturating_add(1);
            return true;
        }
        false
    }

    fn stats(&self) -> &RenderStats {
        &self.stats_
    }
}

pub struct DisplaySceneRenderer<D: DisplayDriver> {
    display: D,
    current_scene: Option<crate::ui::Scene>,
    stats_: RenderStats,
    force_next_render: bool,
}

impl<D: DisplayDriver> DisplaySceneRenderer<D> {
    pub fn new(mut display: D) -> Self {
        let _ = display.init();
        let _ = display.set_brightness(128);
        Self {
            display,
            current_scene: None,
            stats_: RenderStats::new(),
            force_next_render: true,
        }
    }

    pub fn force_render_once(&mut self) {
        self.force_next_render = true;
    }
}

impl<D: DisplayDriver> SceneRenderer for DisplaySceneRenderer<D> {
    fn render(&mut self, state: &RuntimeState, _now_ms: u64) -> bool {
        self.stats_.frames_requested = self.stats_.frames_requested.saturating_add(1);
        let target = state.scene();
        if self.force_next_render || self.current_scene != Some(target) {
            let _ = self.display.flush_region(
                Rect {
                    x: 0,
                    y: 0,
                    w: self.display.width(),
                    h: self.display.height(),
                },
                &[],
            );
            self.current_scene = Some(target);
            self.force_next_render = false;
            self.stats_.scenes_rendered = self.stats_.scenes_rendered.saturating_add(1);
            return true;
        }
        false
    }

    fn stats(&self) -> &RenderStats {
        &self.stats_
    }
}
