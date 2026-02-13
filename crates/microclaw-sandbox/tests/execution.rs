use microclaw_sandbox::{AppleContainerRunner, CommandResult, Executor, RunSpec};

struct StubExecutor;

impl Executor for StubExecutor {
    fn run(&self, args: &[String]) -> Result<CommandResult, String> {
        Ok(CommandResult {
            status: 0,
            stdout: args.join(" "),
            stderr: String::new(),
        })
    }
}

#[test]
fn runner_executes_via_executor() {
    let spec = RunSpec::new("microclaw-agent:latest", vec!["/bin/sh".into()]);
    let runner = AppleContainerRunner::new(StubExecutor);
    let result = runner.run(&spec).unwrap();
    assert!(result.stdout.contains("container"));
    assert!(result.stdout.contains("microclaw-agent:latest"));
}
