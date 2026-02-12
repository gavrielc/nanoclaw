use microclaw_bus::Bus;
use microclaw_protocol::{Envelope, MessageId};

#[test]
fn drops_duplicate_message_ids() {
    let mut bus = Bus::open_in_memory().unwrap();
    let env = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    assert!(bus.publish(env.clone()).unwrap());
    assert!(!bus.publish(env).unwrap());
}

#[test]
fn replays_events_after_seq() {
    let mut bus = Bus::open_in_memory().unwrap();
    let mut env1 = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    let mut env2 = Envelope::new("device", "dev1", "sess_default", MessageId::new("m2"));
    env1.seq = 1;
    env2.seq = 2;
    bus.publish(env1.clone()).unwrap();
    bus.publish(env2.clone()).unwrap();

    let replay = bus.replay_from_seq(0).unwrap();
    assert_eq!(replay.len(), 2);
    assert_eq!(replay[0].message_id.as_str(), "m1");
    assert_eq!(replay[1].message_id.as_str(), "m2");
}
