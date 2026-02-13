use microclaw_sandbox::{AppleContainerRunner, DockerRunner, ProcessExecutor, RunSpec};

#[test]
fn docker_disables_network_when_no_egress() {
    let spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    let args = DockerRunner::build_command(&spec);
    assert!(args.iter().any(|arg| arg == "--network=none"));
}

#[test]
fn docker_allows_network_when_egress_present() {
    let mut spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    spec.add_egress_host("api.example.com");
    let args = DockerRunner::build_command(&spec);
    assert!(!args.iter().any(|arg| arg == "--network=none"));
}

#[test]
fn apple_container_disables_network_when_no_egress() {
    let spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    let args = AppleContainerRunner::<ProcessExecutor>::build_command(&spec);
    assert!(args.iter().any(|arg| arg == "--network=none"));
}

#[test]
fn apple_container_allows_network_when_egress_present() {
    let mut spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    spec.add_egress_host("api.example.com");
    let args = AppleContainerRunner::<ProcessExecutor>::build_command(&spec);
    assert!(!args.iter().any(|arg| arg == "--network=none"));
}

#[test]
fn network_disabled_default_is_true() {
    let spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    assert!(spec.network_disabled());
}

#[test]
fn network_disabled_false_when_egress_present() {
    let mut spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    spec.add_egress_host("api.example.com");
    assert!(!spec.network_disabled());
}

#[test]
fn apple_runner_exec_uses_network_default() {
    let executor = ProcessExecutor;
    let runner = AppleContainerRunner::new(executor);
    let spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    let args = AppleContainerRunner::<ProcessExecutor>::build_command(&spec);
    assert!(args.contains(&"--network=none".to_string()));
    let _ = runner; // compile check
}
