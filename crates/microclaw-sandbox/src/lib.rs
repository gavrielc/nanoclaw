pub trait ContainerBackend {
    fn name(&self) -> &'static str;
}

use std::collections::{HashMap, HashSet};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Mount {
    pub source: String,
    pub target: String,
    pub read_only: bool,
}

impl Mount {
    pub fn read_only(source: &str, target: &str) -> Self {
        Self {
            source: source.to_string(),
            target: target.to_string(),
            read_only: true,
        }
    }

    fn to_apple_arg(&self) -> String {
        let mut arg = format!("type=bind,src={},dst={}", self.source, self.target);
        if self.read_only {
            arg.push_str(",readonly");
        }
        arg
    }

    fn to_docker_arg(&self) -> String {
        let suffix = if self.read_only { ":ro" } else { "" };
        format!("{}:{}{}", self.source, self.target, suffix)
    }
}

#[derive(Debug, Clone)]
pub enum PolicyError {
    MountNotAllowed(String),
    EgressNotAllowed(String),
}

pub struct MountPolicy {
    allowed_prefixes: Vec<String>,
}

impl MountPolicy {
    pub fn new(allowed_prefixes: Vec<String>) -> Self {
        Self { allowed_prefixes }
    }

    pub fn validate(&self, mounts: &[Mount]) -> Result<(), PolicyError> {
        for mount in mounts {
            let allowed = self
                .allowed_prefixes
                .iter()
                .any(|prefix| mount.source.starts_with(prefix));
            if !allowed {
                return Err(PolicyError::MountNotAllowed(mount.source.clone()));
            }
        }
        Ok(())
    }
}

pub struct EgressPolicy {
    allowlist: Vec<String>,
}

impl EgressPolicy {
    pub fn new(allowlist: Vec<String>) -> Self {
        Self { allowlist }
    }

    pub fn allows(&self, host: &str) -> bool {
        self.allowlist.iter().any(|entry| entry == host)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEvent {
    pub action: String,
    pub target: String,
    pub allowed: bool,
}

pub struct AuditLog {
    events: Vec<AuditEvent>,
}

impl AuditLog {
    pub fn new() -> Self {
        Self { events: Vec::new() }
    }

    pub fn record(&mut self, event: AuditEvent) {
        self.events.push(event);
    }

    pub fn entries(&self) -> &[AuditEvent] {
        &self.events
    }
}

pub struct SecretBroker {
    allowlist: HashSet<String>,
    secrets: HashMap<String, String>,
    audit: AuditLog,
}

impl SecretBroker {
    pub fn new(allowlist: Vec<String>, secrets: HashMap<String, String>) -> Self {
        Self {
            allowlist: allowlist.into_iter().collect(),
            secrets,
            audit: AuditLog::new(),
        }
    }

    pub fn request(&mut self, key: &str) -> Option<String> {
        let allowed = self.allowlist.contains(key) && self.secrets.contains_key(key);
        let value = if allowed {
            self.secrets.get(key).cloned()
        } else {
            None
        };
        self.audit.record(AuditEvent {
            action: "secret.request".to_string(),
            target: key.to_string(),
            allowed,
        });
        value
    }

    pub fn audit(&self) -> &AuditLog {
        &self.audit
    }
}

#[derive(Debug, Clone)]
pub struct RunSpec {
    pub image: String,
    pub command: Vec<String>,
    pub mounts: Vec<Mount>,
    pub env: Vec<(String, String)>,
    pub egress_hosts: Vec<String>,
}

impl RunSpec {
    pub fn new(image: &str, command: Vec<String>) -> Self {
        Self {
            image: image.to_string(),
            command,
            mounts: Vec::new(),
            env: Vec::new(),
            egress_hosts: Vec::new(),
        }
    }

    pub fn add_mount(&mut self, mount: Mount) {
        self.mounts.push(mount);
    }

    pub fn add_env(&mut self, key: &str, value: &str) {
        self.env.push((key.to_string(), value.to_string()));
    }

    pub fn add_egress_host(&mut self, host: &str) {
        self.egress_hosts.push(host.to_string());
    }

    pub fn network_disabled(&self) -> bool {
        self.egress_hosts.is_empty()
    }

    pub fn validate(
        &self,
        mount_policy: &MountPolicy,
        egress_policy: &EgressPolicy,
    ) -> Result<(), PolicyError> {
        mount_policy.validate(&self.mounts)?;
        for host in &self.egress_hosts {
            if !egress_policy.allows(host) {
                return Err(PolicyError::EgressNotAllowed(host.clone()));
            }
        }
        Ok(())
    }
}

pub struct DockerRunner;

impl DockerRunner {
    pub fn build_command(spec: &RunSpec) -> Vec<String> {
        let mut args = vec!["docker".to_string(), "run".to_string(), "--rm".to_string()];
        if spec.network_disabled() {
            args.push("--network=none".to_string());
        }
        for mount in &spec.mounts {
            args.push("-v".to_string());
            args.push(mount.to_docker_arg());
        }
        for (key, value) in &spec.env {
            args.push("-e".to_string());
            args.push(format!("{}={}", key, value));
        }
        args.push(spec.image.clone());
        args.extend(spec.command.iter().cloned());
        args
    }
}

#[derive(Debug, Clone)]
pub struct CommandResult {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

pub trait Executor {
    fn run(&self, args: &[String]) -> Result<CommandResult, String>;
}

pub struct ProcessExecutor;

impl Executor for ProcessExecutor {
    fn run(&self, args: &[String]) -> Result<CommandResult, String> {
        let (program, rest) = args
            .split_first()
            .ok_or_else(|| "empty command".to_string())?;
        let output = Command::new(program)
            .args(rest)
            .output()
            .map_err(|err| format!("failed to execute {}: {}", program, err))?;
        Ok(CommandResult {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

pub struct AppleContainerRunner<E> {
    executor: E,
}

impl<E: Executor> AppleContainerRunner<E> {
    pub fn new(executor: E) -> Self {
        Self { executor }
    }

    pub fn build_command(spec: &RunSpec) -> Vec<String> {
        let mut args = vec![
            "container".to_string(),
            "run".to_string(),
            "--rm".to_string(),
        ];
        if spec.network_disabled() {
            args.push("--network=none".to_string());
        }
        for mount in &spec.mounts {
            args.push("--mount".to_string());
            args.push(mount.to_apple_arg());
        }
        for (key, value) in &spec.env {
            args.push("--env".to_string());
            args.push(format!("{}={}", key, value));
        }
        args.push(spec.image.clone());
        args.extend(spec.command.iter().cloned());
        args
    }

    pub fn run(&self, spec: &RunSpec) -> Result<CommandResult, String> {
        let args = Self::build_command(spec);
        self.executor.run(&args)
    }

    pub fn run_with_policy(
        &self,
        spec: &RunSpec,
        mount_policy: &MountPolicy,
        egress_policy: &EgressPolicy,
    ) -> Result<CommandResult, String> {
        spec.validate(mount_policy, egress_policy)
            .map_err(|err| format!("policy violation: {:?}", err))?;
        self.run(spec)
    }
}

pub struct DockerRunnerExec<E> {
    executor: E,
}

impl<E: Executor> DockerRunnerExec<E> {
    pub fn new(executor: E) -> Self {
        Self { executor }
    }

    pub fn run(&self, spec: &RunSpec) -> Result<CommandResult, String> {
        let args = DockerRunner::build_command(spec);
        self.executor.run(&args)
    }

    pub fn run_with_policy(
        &self,
        spec: &RunSpec,
        mount_policy: &MountPolicy,
        egress_policy: &EgressPolicy,
    ) -> Result<CommandResult, String> {
        spec.validate(mount_policy, egress_policy)
            .map_err(|err| format!("policy violation: {:?}", err))?;
        self.run(spec)
    }
}

pub struct AppleContainer;

impl AppleContainer {
    pub fn new() -> Self {
        Self
    }
}

impl ContainerBackend for AppleContainer {
    fn name(&self) -> &'static str {
        "apple"
    }
}

pub struct DockerBackend;

impl DockerBackend {
    pub fn new() -> Self {
        Self
    }
}

impl ContainerBackend for DockerBackend {
    fn name(&self) -> &'static str {
        "docker"
    }
}
