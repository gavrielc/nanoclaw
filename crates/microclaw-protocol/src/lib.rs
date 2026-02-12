#[derive(Clone, Debug)]
pub struct MessageId(String);

impl MessageId {
    pub fn new(v: impl Into<String>) -> Self {
        Self(v.into())
    }
}

#[derive(Clone, Debug)]
pub struct Envelope {
    pub v: u8,
    pub seq: u64,
    pub source: String,
    pub device_id: String,
    pub session_id: String,
    pub message_id: MessageId,
}

impl Envelope {
    pub fn new(source: &str, device_id: &str, session_id: &str, message_id: MessageId) -> Self {
        Self {
            v: 1,
            seq: 1,
            source: source.into(),
            device_id: device_id.into(),
            session_id: session_id.into(),
            message_id,
        }
    }
}
