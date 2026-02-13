use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

pub struct GroupQueue<T> {
    per_group: HashMap<String, VecDeque<T>>,
    capacity: usize,
}

impl<T> GroupQueue<T> {
    pub fn new(capacity: usize) -> Self {
        Self {
            per_group: HashMap::new(),
            capacity,
        }
    }

    pub fn push(&mut self, group: &str, item: T) {
        let q = self.per_group.entry(group.to_string()).or_default();
        if q.len() < self.capacity {
            q.push_back(item);
        }
    }

    pub fn pop(&mut self, group: &str) -> Option<T> {
        self.per_group.get_mut(group).and_then(|q| q.pop_front())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub max_attempts: usize,
    pub backoff_ms: u64,
}

impl RetryPolicy {
    pub fn new(max_attempts: usize, backoff_ms: u64) -> Self {
        Self {
            max_attempts,
            backoff_ms,
        }
    }
}

#[derive(Debug)]
pub struct QueuedItem<T> {
    pub id: String,
    pub group: String,
    pub payload: T,
    pub attempts: usize,
    ready_at_ms: u64,
}

impl<T> QueuedItem<T> {
    fn new(id: &str, group: &str, payload: T) -> Self {
        Self {
            id: id.to_string(),
            group: group.to_string(),
            payload,
            attempts: 0,
            ready_at_ms: 0,
        }
    }
}

pub struct ExecutionQueue<T> {
    per_group: BTreeMap<String, VecDeque<QueuedItem<T>>>,
    inflight_groups: HashSet<String>,
    inflight_limit: usize,
    inflight: usize,
    retry: RetryPolicy,
}

impl<T> ExecutionQueue<T> {
    pub fn new(inflight_limit: usize, retry: RetryPolicy) -> Self {
        Self {
            per_group: BTreeMap::new(),
            inflight_groups: HashSet::new(),
            inflight_limit,
            inflight: 0,
            retry,
        }
    }

    pub fn enqueue(&mut self, group: &str, id: &str, payload: T) {
        let queue = self.per_group.entry(group.to_string()).or_default();
        queue.push_back(QueuedItem::new(id, group, payload));
    }

    pub fn next_ready(&mut self, now_ms: u64) -> Option<QueuedItem<T>> {
        if self.inflight >= self.inflight_limit {
            return None;
        }

        for (group, queue) in self.per_group.iter_mut() {
            if self.inflight_groups.contains(group) {
                continue;
            }
            let ready = queue
                .front()
                .map(|item| item.ready_at_ms <= now_ms)
                .unwrap_or(false);
            if ready {
                let mut item = queue.pop_front()?;
                item.attempts += 1;
                self.inflight += 1;
                self.inflight_groups.insert(item.group.clone());
                return Some(item);
            }
        }
        None
    }

    pub fn complete(&mut self, mut item: QueuedItem<T>, ok: bool, now_ms: u64) {
        self.inflight = self.inflight.saturating_sub(1);
        self.inflight_groups.remove(&item.group);
        if ok || item.attempts >= self.retry.max_attempts {
            return;
        }
        item.ready_at_ms = now_ms + self.retry.backoff_ms;
        let queue = self.per_group.entry(item.group.clone()).or_default();
        queue.push_back(item);
    }
}
