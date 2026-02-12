use microclaw_bus::Bus;
use microclaw_protocol::{Envelope, MessageId};

#[test]
fn drops_duplicate_message_ids() {
    let mut bus = Bus::new();
    let env = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    assert!(bus.publish(env.clone()));
    assert!(!bus.publish(env));
}
