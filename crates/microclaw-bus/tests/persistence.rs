use microclaw_bus::Bus;
use microclaw_protocol::{Envelope, MessageId};

#[test]
fn assigns_sequence_when_missing() {
    let mut bus = Bus::open_in_memory().unwrap();
    let mut env1 = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    let mut env2 = Envelope::new("device", "dev1", "sess_default", MessageId::new("m2"));
    env1.seq = 0;
    env2.seq = 0;
    bus.publish(env1).unwrap();
    bus.publish(env2).unwrap();
    let replay = bus.replay_from_seq(0).unwrap();
    assert_eq!(replay.len(), 2);
    assert_eq!(replay[0].seq, 1);
    assert_eq!(replay[1].seq, 2);
}

#[test]
fn persists_to_file_and_replays() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();
    let mut bus = Bus::open(&path).unwrap();
    let mut env = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    env.seq = 0;
    bus.publish(env).unwrap();
    drop(bus);

    let bus = Bus::open(&path).unwrap();
    let replay = bus.replay_from_seq(0).unwrap();
    assert_eq!(replay.len(), 1);
    assert_eq!(replay[0].message_id.as_str(), "m1");
}
