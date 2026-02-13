# HAL Harness Evaluation Plan (Agent Tuning)

This plan shows how to use the HAL harness from Princeton PLI to evaluate and tune microClaw/nanoclaw agents with reproducible, comparable runs. It assumes the ESP32-S3 device uses a remote host for heavy execution (LLM, tools, ASR/TTS).

Scope:
- Use HAL as a standardized evaluation harness with a single CLI (`hal-eval`) and consistent reporting.
- Run existing public benchmarks for baseline comparability.
- Add a microClaw-specific benchmark to measure our harness behavior under realistic constraints.

## Why HAL (Fit Check)

HAL provides:
- A unified evaluation CLI across benchmarks and agents.
- Local/Docker/Azure execution with configurable parallelism.
- Automatic logging with Weave integration and trace capture.
- No constraints on agent frameworks; supports custom agents and Inspect AI solvers.
- A path to upload results and share traces (with encryption before upload).

These align with our needs: we can wrap microClaw in a simple agent adapter and then compare runs across benchmarks without changing the core system.

Supported benchmark families in HAL include:
- SWE-bench Verified (full and mini)
- USACO
- AppWorld
- CORE-bench
- tau-bench
- Inspect AI tasks (e.g., Gaia, Cybench, AgentHarm)

## Plan Overview (Phased)

### Phase 0: Establish the HAL environment

Goal: get a clean, repeatable evaluation environment.

Steps:
1. Clone HAL with submodules and install the package in a conda environment.
2. Create `.env` from template and add the model provider keys we will use.
3. Install any model provider SDKs required by HAL.
4. Confirm `hal-eval` runs (dry run or a small benchmark).

Example commands:

```bash
git clone --recursive https://github.com/princeton-pli/hal-harness.git
cd hal-harness
conda create -n hal python=3.12
conda activate hal
pip install -e .
cp .env.template .env
```

### Phase 1: Create a microClaw agent adapter

Goal: make microClaw appear as a HAL agent with minimal glue.

Design:
- A thin Python adapter in `agents/` that:
  - forwards prompts/tasks to our microClaw host API
  - streams results back in HAL's expected format
  - emits structured traces for comparison
- A config block for model selection and tool policy (so we can compare runs under different budgets).

Deliverable:
- `agents/microclaw_agent/` with a `run()` entrypoint for `hal-eval`.

### Phase 2: Baseline against public benchmarks

Goal: establish an external baseline for our harness.

Steps:
- Run 2-3 benchmarks that stress our tool use and multi-step reasoning (start small, then scale).
- Use `hal-eval` with explicit run settings:
  - fixed model
  - fixed tool policy
  - fixed max cost/time budget
- Capture traces and costs via Weave.

Example `hal-eval` invocation:

```bash
hal-eval --benchmark <benchmark_name> \
  --agent_dir agents/microclaw_agent \
  --agent_function main.run \
  --agent_name "microClaw (model-name)" \
  -A model_name=<model_name>
```

### Phase 3: Add a microClaw-specific benchmark

Goal: measure the harness behavior we actually care about.

Design principles:
- Use tasks that mirror our real workflows:
  - tool invocation sequences
  - structured IO (file ops, schedule tasks, IPC-style messages)
  - guardrail checks (mount allowlist, egress policy)
- Encode as a HAL benchmark (or as an Inspect AI task if it is easier to express).

Deliverable:
- `hal/benchmarks/microclaw/` or `inspect_evals/microclaw_*` with a small, deterministic test set.

### Phase 4: Tuning loop

Goal: tune prompts, policies, and tool orchestration using repeatable evals.

Loop:
1. Run baseline (store outputs + metrics).
2. Change exactly one variable (prompt, tool order, budget, or policy).
3. Re-run the same eval set with a new run id.
4. Compare:
   - success rate
   - cost
   - latency (where available)
   - trace-level errors (policy denials, tool failures)

### Phase 5: CI integration (optional)

Goal: keep regressions visible.

Steps:
- Run a tiny benchmark subset on every PR.
- Run a larger suite nightly.

Optional: results upload flow:

```bash
# Upload all results for a benchmark
hal-upload -B <benchmark_name>
```

## Metrics We Track

Core:
- Task success rate
- Cost per task
- Failure categories (tool error, policy denial, timeout)
- Latency to first/last token (if captured)

microClaw-specific:
- Tool IPC error rate
- Sandbox policy violations (attempted vs denied)
- Resource budget overruns (timeouts, output truncation)

## Open Decisions

1. Which initial benchmarks to run first.
2. Whether to wrap the microClaw host as:
   - a custom HAL agent, or
   - an Inspect AI solver (if that is easier for tool-heavy tasks).
3. How to collect latency metrics in the HAL pipeline (trace metadata vs external instrumentation).

## References

- HAL harness repo: https://github.com/princeton-pli/hal-harness
