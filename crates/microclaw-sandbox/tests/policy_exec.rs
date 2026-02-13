use microclaw_sandbox::{
    AppleContainerRunner, CommandResult, EgressPolicy, Executor, Mount, MountPolicy, RunSpec,
};

struct StubExecutor;

impl Executor for StubExecutor {
    fn run(&self, _args: &[String]) -> Result<CommandResult, String> {
        Ok(CommandResult {
            status: 0,
            stdout: "ok".to_string(),
            stderr: String::new(),
        })
    }
}

#[test]
fn runner_blocks_disallowed_mounts() {
    let mut spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    spec.add_mount(Mount::read_only("/blocked/path", "/workspace/data"));
    let mount_policy = MountPolicy::new(vec!["/allowed".to_string()]);
    let egress_policy = EgressPolicy::new(vec![]);
    let runner = AppleContainerRunner::new(StubExecutor);
    let result = runner.run_with_policy(&spec, &mount_policy, &egress_policy);
    assert!(result.is_err());
}

#[test]
fn runner_blocks_disallowed_egress() {
    let mut spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    spec.add_egress_host("api.example.com");
    let mount_policy = MountPolicy::new(vec![]);
    let egress_policy = EgressPolicy::new(vec![]);
    let runner = AppleContainerRunner::new(StubExecutor);
    let result = runner.run_with_policy(&spec, &mount_policy, &egress_policy);
    assert!(result.is_err());
}
