use microclaw_protocol::{Envelope, MessageId};

#[test]
fn creates_envelope_with_seq() {
    let env = Envelope::new("device", "dev1", "sess_default", MessageId::new("m1"));
    assert_eq!(env.seq, 1);
}
