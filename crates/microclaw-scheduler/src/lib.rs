use std::time::SystemTime;

pub struct TaskSpec {
    id: String,
    at: SystemTime,
}

impl TaskSpec {
    pub fn once(id: &str, at: SystemTime) -> Self {
        Self { id: id.to_string(), at }
    }
}

pub struct Scheduler {
    tasks: Vec<TaskSpec>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self { tasks: Vec::new() }
    }

    pub fn add(&mut self, task: TaskSpec) {
        self.tasks.push(task);
    }

    pub fn due(&self, now: SystemTime) -> Vec<&TaskSpec> {
        self.tasks.iter().filter(|t| t.at <= now).collect()
    }
}
