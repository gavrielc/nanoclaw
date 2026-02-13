use std::collections::HashMap;

use microclaw_sandbox::{AuditEvent, SecretBroker};

#[test]
fn broker_denies_unlisted_secret_and_logs() {
    let mut secrets = HashMap::new();
    secrets.insert("API_KEY".to_string(), "secret".to_string());
    let mut broker = SecretBroker::new(vec!["API_KEY".to_string()], secrets);

    assert_eq!(broker.request("TOKEN"), None);
    let events = broker.audit().entries();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        AuditEvent {
            action: "secret.request".to_string(),
            target: "TOKEN".to_string(),
            allowed: false,
        }
    );
}

#[test]
fn broker_returns_secret_and_logs() {
    let mut secrets = HashMap::new();
    secrets.insert("API_KEY".to_string(), "secret".to_string());
    let mut broker = SecretBroker::new(vec!["API_KEY".to_string()], secrets);

    assert_eq!(broker.request("API_KEY"), Some("secret".to_string()));
    let events = broker.audit().entries();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        AuditEvent {
            action: "secret.request".to_string(),
            target: "API_KEY".to_string(),
            allowed: true,
        }
    );
}
