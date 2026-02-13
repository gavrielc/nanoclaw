use microclaw_sandbox::{DockerRunner, Mount, RunSpec};

#[test]
fn builds_docker_command() {
    let mut spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    spec.add_mount(Mount::read_only("/host/data", "/workspace/data"));
    spec.add_env("TOKEN", "redacted");

    let args = DockerRunner::build_command(&spec);
    assert_eq!(args[0], "docker");
    assert!(args.contains(&"run".to_string()));
    assert!(args.contains(&"--rm".to_string()));
    assert!(args
        .iter()
        .any(|arg| arg.contains("/host/data:/workspace/data:ro")));
    assert!(args.iter().any(|arg| arg == "TOKEN=redacted"));
    assert!(args.iter().any(|arg| arg == "microclaw-agent:latest"));
}
