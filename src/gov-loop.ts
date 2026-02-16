/**
 * Governance Dispatch Loop
 *
 * Polls for governance tasks in actionable states and auto-dispatches them:
 * 1. READY + assigned_group → transition to DOING, dispatch to developer container
 * 2. REVIEW + gate != None → transition to APPROVAL, dispatch to gate approver container
 *
 * Uses gov_dispatches table for idempotent dispatch (crash-safe).
 */
import { ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
} from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllActiveCapabilities,
} from './ext-broker-db.js';
import {
  getAllProviderNames,
  getProviderActionCatalog,
} from './ext-broker-providers.js';
import {
  countDoingTasksByGroup,
  getAllGovTasks,
  getDispatchableGovTasks,
  getGovActivities,
  getGovActivitiesForContext,
  getGovApprovals,
  getGovTaskById,
  getGovTaskExecutionSummary,
  getProductById,
  getReviewableGovTasks,
  logGovActivity,
  tryCreateDispatch,
  updateDispatchStatus,
  updateGovTask,
} from './gov-db.js';
import { getExtCalls } from './ext-broker-db.js';
import { getAllTasks } from './db.js';
import { GATE_APPROVER } from './governance/gates.js';
import type { GateType } from './governance/gates.js';
import { validateTransition } from './governance/policy.js';
import type { GovTask } from './governance/constants.js';
import { recallRelevantMemory } from './memory/recall.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { emitOpsEvent } from './ops-events.js';
import { RegisteredGroup } from './types.js';

export const GOV_POLL_INTERVAL = parseInt(
  process.env.GOV_POLL_INTERVAL || '10000',
  10,
);

export const GOV_MAX_WIP_PER_GROUP = parseInt(
  process.env.GOV_MAX_WIP_PER_GROUP || '2',
  10,
);

export const GOV_MAX_WIP_TOTAL = parseInt(
  process.env.GOV_MAX_WIP_TOTAL || '8',
  10,
);

export interface GovLoopDeps {
  registeredGroups: () => Record<string, RegisteredGroup>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
  getSessions: () => Record<string, string>;
  // Optional: multi-node worker dispatch
  selectWorker?: (group?: string) => { id: string; [key: string]: unknown } | null;
  dispatchToWorker?: (workerId: string, payload: unknown) => Promise<{ ok: boolean; status: string }>;
  isTunnelUp?: (workerId: string) => boolean;
}

let govLoopRunning = false;

export function startGovLoop(deps: GovLoopDeps): void {
  if (govLoopRunning) {
    logger.debug('Governance loop already running, skipping duplicate start');
    return;
  }
  govLoopRunning = true;
  logger.info('Governance dispatch loop started');

  const loop = async () => {
    try {
      await dispatchReadyTasks(deps);
      await dispatchReviewTasks(deps);
    } catch (err) {
      logger.error({ err }, 'Error in governance loop');
    }

    setTimeout(loop, GOV_POLL_INTERVAL);
  };

  loop();
}

/**
 * READY + assigned_group → DOING (dispatch to developer)
 */
async function dispatchReadyTasks(deps: GovLoopDeps): Promise<void> {
  const readyTasks = getDispatchableGovTasks();

  for (const task of readyTasks) {
    if (!task.assigned_group) continue;

    // Skip dispatch for non-active products (paused/killed stay READY)
    if (task.product_id) {
      const product = getProductById(task.product_id);
      if (product && product.status !== 'active') {
        logGovActivity({
          task_id: task.id,
          action: 'dispatch_skipped',
          from_state: 'READY',
          to_state: null,
          actor: 'system',
          reason: `DISPATCH_SKIPPED_PRODUCT_NOT_ACTIVE (status=${product.status})`,
          created_at: new Date().toISOString(),
        });
        logger.debug(
          { taskId: task.id, productId: task.product_id, productStatus: product.status },
          'Gov dispatch: product not active, skipping',
        );
        continue;
      }
    }

    // WIP limit: per-group
    const doingCount = countDoingTasksByGroup(task.assigned_group);
    if (doingCount >= GOV_MAX_WIP_PER_GROUP) {
      logger.debug(
        { taskId: task.id, group: task.assigned_group, doingCount, limit: GOV_MAX_WIP_PER_GROUP },
        'Gov dispatch: WIP limit reached for group, skipping',
      );
      continue;
    }

    // [Sprint 9] Try remote dispatch if workers are available
    if (deps.selectWorker) {
      const worker = deps.selectWorker(task.assigned_group!);
      if (worker) {
        const remoteDispatchKey = `${task.id}:READY->DOING:v${task.version}`;
        const remoteNow = new Date().toISOString();

        const remoteClaimed = tryCreateDispatch({
          task_id: task.id,
          from_state: 'READY',
          to_state: 'DOING',
          dispatch_key: remoteDispatchKey,
          group_jid: task.assigned_group!,
          worker_id: worker.id,
          status: 'ENQUEUED',
          created_at: remoteNow,
          updated_at: remoteNow,
        });

        if (!remoteClaimed) continue;

        if (!deps.isTunnelUp?.(worker.id)) {
          logGovActivity({
            task_id: task.id,
            action: 'dispatch_deferred',
            from_state: 'READY',
            to_state: null,
            actor: 'system',
            reason: 'DISPATCH_DEFERRED_TUNNEL_DOWN',
            created_at: remoteNow,
          });
          updateDispatchStatus(remoteDispatchKey, 'FAILED');
          emitOpsEvent('dispatch:lifecycle', {
            taskId: task.id, workerId: worker.id, status: 'DEFERRED', reason: 'tunnel_down',
          });
          continue;
        }

        // Build payload for remote worker
        const group = Object.values(deps.registeredGroups()).find(
          (g) => g.folder === task.assigned_group,
        );
        const isMain = task.assigned_group === MAIN_GROUP_FOLDER;
        const prompt = buildGovTaskPrompt(task);
        const sessions = deps.getSessions();

        const remotePayload = {
          taskId: task.id,
          groupFolder: task.assigned_group!,
          prompt,
          sessionId: sessions[task.assigned_group!],
          isMain,
          ipcSecret: '',  // Worker will use its own
        };

        const result = await deps.dispatchToWorker!(worker.id, remotePayload);
        if (result.ok) {
          const updated = updateGovTask(task.id, task.version, { state: 'DOING' });
          if (updated) {
            logGovActivity({
              task_id: task.id,
              action: 'transition',
              from_state: 'READY',
              to_state: 'DOING',
              actor: 'system',
              reason: `Auto-dispatched to worker ${worker.id}`,
              created_at: remoteNow,
            });
            updateDispatchStatus(remoteDispatchKey, 'STARTED');
            emitOpsEvent('dispatch:lifecycle', {
              taskId: task.id, workerId: worker.id, status: 'STARTED',
              from: 'READY', to: 'DOING',
            });
            logger.info(
              { taskId: task.id, workerId: worker.id, dispatchKey: remoteDispatchKey },
              'Gov dispatch: READY -> DOING (remote worker)',
            );
          } else {
            updateDispatchStatus(remoteDispatchKey, 'FAILED');
            emitOpsEvent('dispatch:lifecycle', {
              taskId: task.id, workerId: worker.id, status: 'FAILED', reason: 'version_conflict',
            });
          }
        } else {
          updateDispatchStatus(remoteDispatchKey, 'FAILED');
          emitOpsEvent('dispatch:lifecycle', {
            taskId: task.id, workerId: worker.id, status: 'FAILED', reason: result.status,
          });
        }
        continue;
      }
    }

    // Fall through to local dispatch
    const groupJid = resolveGroupJid(task.assigned_group, deps);
    if (!groupJid) {
      logger.warn(
        { taskId: task.id, group: task.assigned_group },
        'Gov dispatch: assigned group not registered, skipping',
      );
      continue;
    }

    // Idempotent dispatch via gov_dispatches UNIQUE key
    const dispatchKey = `${task.id}:READY->DOING:v${task.version}`;
    const now = new Date().toISOString();

    const claimed = tryCreateDispatch({
      task_id: task.id,
      from_state: 'READY',
      to_state: 'DOING',
      dispatch_key: dispatchKey,
      group_jid: groupJid,
      status: 'ENQUEUED',
      created_at: now,
      updated_at: now,
    });

    if (!claimed) {
      // Already dispatched (previous loop iteration or crash recovery)
      continue;
    }

    // Validate transition
    const result = validateTransition('READY', 'DOING');
    if (!result.ok) {
      logger.warn({ taskId: task.id, errors: result.errors }, 'Gov dispatch: policy denied READY->DOING');
      updateDispatchStatus(dispatchKey, 'FAILED');
      continue;
    }

    // Optimistic locking update
    const updated = updateGovTask(task.id, task.version, { state: 'DOING' });
    if (!updated) {
      logger.warn({ taskId: task.id }, 'Gov dispatch: version conflict on READY->DOING');
      updateDispatchStatus(dispatchKey, 'FAILED');
      continue;
    }

    logGovActivity({
      task_id: task.id,
      action: 'transition',
      from_state: 'READY',
      to_state: 'DOING',
      actor: 'system',
      reason: 'Auto-dispatched by governance loop',
      created_at: now,
    });

    // Enqueue container execution
    const group = deps.registeredGroups()[groupJid];
    deps.queue.enqueueTask(groupJid, `gov-${task.id}`, async () => {
      updateDispatchStatus(dispatchKey, 'STARTED');
      try {
        await runGovTask(task, group, groupJid, deps);
        updateDispatchStatus(dispatchKey, 'DONE');
      } catch (err) {
        logger.error({ taskId: task.id, err }, 'Gov task execution failed');
        updateDispatchStatus(dispatchKey, 'FAILED');
      }
    });

    logger.info(
      { taskId: task.id, group: task.assigned_group, dispatchKey },
      'Gov dispatch: READY -> DOING',
    );
  }
}

/**
 * REVIEW + gate != None → APPROVAL (dispatch to gate approver)
 */
async function dispatchReviewTasks(deps: GovLoopDeps): Promise<void> {
  const reviewTasks = getReviewableGovTasks();

  for (const task of reviewTasks) {
    const gate = task.gate as GateType;
    if (!gate || gate === ('None' as string)) continue;

    const approverFolder = GATE_APPROVER[gate];
    if (!approverFolder) continue;

    const groupJid = resolveGroupJid(approverFolder, deps);
    if (!groupJid) {
      logger.warn(
        { taskId: task.id, gate, approverFolder },
        'Gov dispatch: gate approver group not registered, skipping',
      );
      continue;
    }

    // Idempotent dispatch
    const dispatchKey = `${task.id}:REVIEW->APPROVAL:v${task.version}`;
    const now = new Date().toISOString();

    const claimed = tryCreateDispatch({
      task_id: task.id,
      from_state: 'REVIEW',
      to_state: 'APPROVAL',
      dispatch_key: dispatchKey,
      group_jid: groupJid,
      status: 'ENQUEUED',
      created_at: now,
      updated_at: now,
    });

    if (!claimed) continue;

    // Validate transition
    const result = validateTransition('REVIEW', 'APPROVAL');
    if (!result.ok) {
      logger.warn({ taskId: task.id, errors: result.errors }, 'Gov dispatch: policy denied REVIEW->APPROVAL');
      updateDispatchStatus(dispatchKey, 'FAILED');
      continue;
    }

    // Optimistic locking update
    const updated = updateGovTask(task.id, task.version, {
      state: 'APPROVAL',
    });
    if (!updated) {
      logger.warn({ taskId: task.id }, 'Gov dispatch: version conflict on REVIEW->APPROVAL');
      updateDispatchStatus(dispatchKey, 'FAILED');
      continue;
    }

    logGovActivity({
      task_id: task.id,
      action: 'transition',
      from_state: 'REVIEW',
      to_state: 'APPROVAL',
      actor: 'system',
      reason: `Auto-dispatched to ${approverFolder} for ${gate} gate approval`,
      created_at: now,
    });

    // Enqueue container execution for the approver
    const group = deps.registeredGroups()[groupJid];
    deps.queue.enqueueTask(groupJid, `gov-approve-${task.id}`, async () => {
      updateDispatchStatus(dispatchKey, 'STARTED');
      try {
        await runGovApprovalTask(task, gate, group, groupJid, deps);
        updateDispatchStatus(dispatchKey, 'DONE');
      } catch (err) {
        logger.error({ taskId: task.id, err }, 'Gov approval task execution failed');
        updateDispatchStatus(dispatchKey, 'FAILED');
      }
    });

    logger.info(
      { taskId: task.id, gate, approver: approverFolder, dispatchKey },
      'Gov dispatch: REVIEW -> APPROVAL',
    );
  }
}

// --- Task execution ---

/**
 * Build cross-agent context for a task: activity log, ext_calls summary, approvals.
 * Gives the receiving agent cognitive continuity from previous agents' work.
 */
export function buildTaskContext(taskId: string, maxActivities = 20): string {
  const sections: string[] = [];

  // Activity log — shows what happened so far (transitions, reasons)
  const activities = getGovActivities(taskId);
  if (activities.length > 0) {
    const recent = activities.slice(-maxActivities);
    sections.push('## Activity Log');
    for (const a of recent) {
      const transition = a.from_state && a.to_state ? `${a.from_state} → ${a.to_state}` : a.action;
      sections.push(`- [${a.created_at}] ${a.actor}: ${transition}${a.reason ? ` — ${a.reason}` : ''}`);
    }
    sections.push('');
  }

  // Approvals — shows who approved what gates
  const approvals = getGovApprovals(taskId);
  if (approvals.length > 0) {
    sections.push('## Gate Approvals');
    for (const ap of approvals) {
      sections.push(`- ${ap.gate_type} approved by ${ap.approved_by} at ${ap.approved_at}${ap.notes ? ` — ${ap.notes}` : ''}`);
    }
    sections.push('');
  }

  // Ext calls — shows what external actions were taken for this task
  // We check all groups since the task may have moved between agents
  try {
    const allCalls = [
      ...getExtCalls('developer', 100),
      ...getExtCalls('security', 100),
      ...getExtCalls('main', 100),
    ].filter(c => c.task_id === taskId);

    if (allCalls.length > 0) {
      const recent = allCalls
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
        .slice(-10);
      sections.push('## External Actions');
      for (const c of recent) {
        const status = c.status === 'executed' ? '✓' : c.status === 'denied' ? '✗' : c.status;
        sections.push(`- [${status}] ${c.provider}/${c.action} by ${c.group_folder} (${c.created_at})`);
      }
      sections.push('');
    }
  } catch {
    // ext_calls table may not exist in tests — safe to skip
  }

  return sections.join('\n');
}

function buildGovTaskPrompt(task: GovTask): string {
  const lines = [
    `You have a governance task assigned:`,
    `- ID: ${task.id}`,
    `- Title: ${task.title}`,
    `- Type: ${task.task_type} | Priority: ${task.priority}`,
    `- Scope: ${task.scope}`,
  ];
  if (task.description) lines.push(`- Description: ${task.description}`);
  if (task.product) lines.push(`- Product: ${task.product}`);

  // Sprint 2: Product context for PRODUCT scope
  if (task.scope === 'PRODUCT' && task.product_id) {
    const product = getProductById(task.product_id);
    if (product) {
      lines.push(`- Product Name: ${product.name} (${product.status}, risk: ${product.risk_level})`);
    }
  }

  // Cross-agent context
  const context = buildTaskContext(task.id);
  if (context) {
    lines.push('');
    lines.push('--- Prior context ---');
    lines.push(context);
  }

  // Sprint 4: Inject relevant memories
  const memResult = recallRelevantMemory({
    query: task.title + ' ' + (task.description || ''),
    accessor_group: task.assigned_group || 'main',
    accessor_is_main: (task.assigned_group || 'main') === MAIN_GROUP_FOLDER,
    scope: task.scope,
    product_id: task.product_id,
    limit: 5,
  });
  if (memResult.memories.length > 0) {
    lines.push('');
    lines.push('--- Relevant Memories ---');
    for (const m of memResult.memories) {
      lines.push(
        `- [${m.level}] ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''}`,
      );
    }
  }

  lines.push('');
  lines.push('When you finish, use the gov_transition tool to move this task to REVIEW with a summary of what you did.');
  lines.push('If you are blocked, move it to BLOCKED with a reason.');

  return lines.join('\n');
}

/**
 * Sprint 2: Build structured Context Pack for approval prompts.
 * Gives the reviewer enough context to decide without chat history.
 */
export function buildContextPack(task: GovTask): string {
  const sections: string[] = [];

  // 1. Product context (if PRODUCT scope)
  if (task.scope === 'PRODUCT' && task.product_id) {
    const product = getProductById(task.product_id);
    if (product) {
      sections.push('## Product Context');
      sections.push(`- Name: ${product.name}`);
      sections.push(`- Status: ${product.status}`);
      sections.push(`- Risk Level: ${product.risk_level}`);
      sections.push('');
    }
  }

  // 2. Task metadata
  sections.push('## Task Metadata');
  sections.push(`- ID: ${task.id}`);
  sections.push(`- Title: ${task.title}`);
  sections.push(`- Type: ${task.task_type} | Priority: ${task.priority}`);
  sections.push(`- Scope: ${task.scope}`);
  if (task.description) sections.push(`- Description: ${task.description}`);
  if (task.executor) sections.push(`- Executor: ${task.executor}`);
  if (task.assigned_group) sections.push(`- Developer group: ${task.assigned_group}`);
  sections.push('');

  // 3. Execution summary
  const summary = getGovTaskExecutionSummary(task.id);
  if (summary) {
    sections.push('## Execution Summary');
    sections.push(summary);
    sections.push('');
  }

  // 4. Evidence links
  const allActivities = getGovActivitiesForContext(task.id, 50);
  const evidenceActivities = allActivities.filter(a => a.action === 'evidence');
  if (evidenceActivities.length > 0) {
    sections.push('## Evidence');
    for (const e of evidenceActivities) {
      sections.push(`- ${e.reason || '(no description)'} [${e.actor}, ${e.created_at}]`);
    }
    sections.push('');
  }

  // 5. Activity excerpt (last 15)
  const recentActivities = getGovActivitiesForContext(task.id, 15);
  if (recentActivities.length > 0) {
    // Reverse to chronological order (DESC → ASC)
    const chronological = [...recentActivities].reverse();
    sections.push('## Activity Log (recent)');
    for (const a of chronological) {
      const transition = a.from_state && a.to_state ? `${a.from_state} → ${a.to_state}` : a.action;
      sections.push(`- [${a.created_at}] ${a.actor}: ${transition}${a.reason ? ` — ${a.reason}` : ''}`);
    }
    sections.push('');
  }

  // Gate approvals
  const approvals = getGovApprovals(task.id);
  if (approvals.length > 0) {
    sections.push('## Gate Approvals');
    for (const ap of approvals) {
      sections.push(`- ${ap.gate_type} approved by ${ap.approved_by} at ${ap.approved_at}${ap.notes ? ` — ${ap.notes}` : ''}`);
    }
    sections.push('');
  }

  // Sprint 4: Inject relevant memories for reviewer context
  const memResult = recallRelevantMemory({
    query: task.title + ' ' + (task.description || ''),
    accessor_group: task.assigned_group || 'main',
    accessor_is_main: (task.assigned_group || 'main') === MAIN_GROUP_FOLDER,
    scope: task.scope,
    product_id: task.product_id,
    limit: 5,
  });
  if (memResult.memories.length > 0) {
    sections.push('## Relevant Memories');
    for (const m of memResult.memories) {
      sections.push(
        `- [${m.level}] ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''}`,
      );
    }
    sections.push('');
  }

  return sections.join('\n');
}

function buildApprovalPrompt(task: GovTask, gate: string): string {
  const lines = [
    `A governance task requires your ${gate} gate approval:`,
    '',
  ];

  // Sprint 2: Inject Context Pack
  const contextPack = buildContextPack(task);
  if (contextPack) {
    lines.push('--- Context Pack ---');
    lines.push(contextPack);
  }

  // Reviewer contract
  lines.push('--- Reviewer Contract ---');
  lines.push(`You must take ONE of the following actions:`);
  lines.push(`1. APPROVE: Use gov_approve for the ${gate} gate, then gov_transition to DONE`);
  lines.push(`2. BLOCK: Use gov_transition to BLOCKED with an explicit reason`);
  lines.push(`3. REWORK: Use gov_transition back to DOING with an explicit reason for the developer`);

  return lines.join('\n');
}

async function runGovTask(
  task: GovTask,
  group: RegisteredGroup,
  groupJid: string,
  deps: GovLoopDeps,
): Promise<void> {
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessions = deps.getSessions();
  const sessionId = sessions[group.folder];
  const prompt = buildGovTaskPrompt(task);

  // Write snapshots before spawn
  writeGovSnapshot(group.folder, isMain);
  writeExtCapabilitiesSnapshot(group.folder, isMain);
  ensureIpcGroupSecret(group.folder);
  const scheduledTasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    scheduledTasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Idle timer
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Gov task idle timeout');
      deps.queue.closeStdin(groupJid);
    }, IDLE_TIMEOUT);
  };

  try {
    await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid: groupJid,
        isMain,
        isScheduledTask: true,
      },
      (proc, containerName) =>
        deps.onProcess(groupJid, proc, containerName, group.folder),
      async (output: ContainerOutput) => {
        if (output.result) {
          await deps.sendMessage(groupJid, output.result);
          resetIdleTimer();
        }
      },
    );
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

async function runGovApprovalTask(
  task: GovTask,
  gate: string,
  group: RegisteredGroup,
  groupJid: string,
  deps: GovLoopDeps,
): Promise<void> {
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessions = deps.getSessions();
  const sessionId = sessions[group.folder];

  // Re-read task for latest version (may have been updated since dispatch)
  const currentTask = getGovTaskById(task.id);
  const prompt = buildApprovalPrompt(currentTask || task, gate);

  writeGovSnapshot(group.folder, isMain);
  writeExtCapabilitiesSnapshot(group.folder, isMain);
  ensureIpcGroupSecret(group.folder);

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Gov approval task idle timeout');
      deps.queue.closeStdin(groupJid);
    }, IDLE_TIMEOUT);
  };

  try {
    await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid: groupJid,
        isMain,
        isScheduledTask: true,
      },
      (proc, containerName) =>
        deps.onProcess(groupJid, proc, containerName, group.folder),
      async (output: ContainerOutput) => {
        if (output.result) {
          await deps.sendMessage(groupJid, output.result);
          resetIdleTimer();
        }
      },
    );
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

// --- Snapshot ---

/**
 * Write governance pipeline snapshot for a group's container.
 * Includes task.version for staleness detection (P0-5).
 */
export function writeGovSnapshot(
  groupFolder: string,
  isMain: boolean,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const allTasks = getAllGovTasks();

  // Main sees all tasks; non-main sees only assigned tasks
  const visibleTasks = isMain
    ? allTasks
    : allTasks.filter((t) => t.assigned_group === groupFolder);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    tasks: visibleTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      task_type: t.task_type,
      state: t.state,
      priority: t.priority,
      product: t.product,
      product_id: t.product_id,
      scope: t.scope,
      assigned_group: t.assigned_group,
      executor: t.executor,
      gate: t.gate,
      version: t.version,
      created_at: t.created_at,
      updated_at: t.updated_at,
    })),
  };

  const snapshotFile = path.join(groupIpcDir, 'gov_pipeline.json');
  const tempPath = `${snapshotFile}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tempPath, snapshotFile);
}

// --- Ext Capabilities Snapshot ---

/**
 * Write ext_capabilities.json snapshot for a group's container.
 * Shows available providers, actions, and the group's access levels.
 */
export function writeExtCapabilitiesSnapshot(
  groupFolder: string,
  _isMain: boolean,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const caps = getAllActiveCapabilities().filter(
    (c) => c.group_folder === groupFolder,
  );

  const capabilities = caps.map((cap) => {
    const catalog = getProviderActionCatalog(cap.provider) || {};
    const denied: string[] = cap.denied_actions ? JSON.parse(cap.denied_actions) : [];

    // Annotate actions: show level, mark denied
    const actions: Record<string, { level: number; description: string; status: string }> = {};
    for (const [name, info] of Object.entries(catalog)) {
      let status = 'available';
      if (info.level > cap.access_level) status = 'requires_higher_level';
      if (denied.includes(name)) status = 'DENIED';
      actions[name] = { level: info.level, description: info.description, status };
    }

    return {
      provider: cap.provider,
      access_level: cap.access_level,
      allowed_actions: cap.allowed_actions ? JSON.parse(cap.allowed_actions) : null,
      denied_actions: denied.length > 0 ? denied : null,
      expires_at: cap.expires_at,
      actions,
    };
  });

  const snapshot = {
    generatedAt: new Date().toISOString(),
    capabilities,
    providers_available: getAllProviderNames(),
  };

  const snapshotFile = path.join(groupIpcDir, 'ext_capabilities.json');
  const tempPath = `${snapshotFile}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tempPath, snapshotFile);
}

/**
 * P0-7: Ensure IPC group secret exists for request signing.
 * Generated once per group, stored at ipc/{groupFolder}/.ipc_secret.
 */
export function ensureIpcGroupSecret(groupFolder: string): void {
  const secretPath = path.join(DATA_DIR, 'ipc', groupFolder, '.ipc_secret');
  if (fs.existsSync(secretPath)) return;

  const dir = path.dirname(secretPath);
  fs.mkdirSync(dir, { recursive: true });

  const secret = crypto.randomBytes(32).toString('hex');
  const tempPath = `${secretPath}.tmp`;
  fs.writeFileSync(tempPath, secret);
  fs.renameSync(tempPath, secretPath);
}

// --- Helpers ---

function resolveGroupJid(
  groupFolder: string,
  deps: GovLoopDeps,
): string | null {
  const groups = deps.registeredGroups();
  const entry = Object.entries(groups).find(
    ([, g]) => g.folder === groupFolder,
  );
  return entry ? entry[0] : null;
}
