use microclaw_sandbox::{AppleContainer, ContainerBackend, DockerBackend};

#[test]
fn apple_backend_reports_name() {
    let backend = AppleContainer::new();
    assert_eq!(backend.name(), "apple");
}

#[test]
fn docker_backend_reports_name() {
    let backend = DockerBackend::new();
    assert_eq!(backend.name(), "docker");
}
