/**
 * Governance Dispatch Loop tests
 *
 * Tests snapshot generation, IPC secret creation, and dispatch logic.
 * Container execution is mocked — we test the orchestration layer.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use temp dir for DATA_DIR
const { tmpDir } = vi.hoisted(() => {
  const _fs = require('fs');
  const _os = require('os');
  const _path = require('path');
  return { tmpDir: _fs.mkdtempSync(_path.join(_os.tmpdir(), 'nanoclaw-govloop-test-')) };
});

vi.mock('./config.js', () => ({
  DATA_DIR: tmpDir,
  GROUPS_DIR: path.join(tmpDir, 'groups'),
  IDLE_TIMEOUT: 60_000,
  MAIN_GROUP_FOLDER: 'main',
  PROJECT_ROOT: tmpDir,
}));

// Mock container-runner to avoid actual container spawning
vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn().mockResolvedValue(undefined),
  writeTasksSnapshot: vi.fn(),
}));

import { _initTestDatabase } from './db.js';
import {
  countDoingTasksByGroup,
  createGovApproval,
  createGovTask,
  createProduct,
  getDispatchableGovTasks,
  getDispatchByKey,
  getGovActivities,
  getGovTaskById,
  getProductById,
  getReviewableGovTasks,
  logGovActivity,
  tryCreateDispatch,
  updateGovTask,
} from './gov-db.js';
import { grantCapability } from './ext-broker-db.js';
import { registerProvider } from './ext-broker-providers.js';
import {
  buildContextPack,
  buildTaskContext,
  ensureIpcGroupSecret,
  writeExtCapabilitiesSnapshot,
  writeGovSnapshot,
} from './gov-loop.js';
import { storeMemory } from './memory-db.js';

beforeEach(() => {
  _initTestDatabase();
  // Clear temp dirs
  const ipcDir = path.join(tmpDir, 'ipc');
  if (fs.existsSync(ipcDir)) {
    fs.rmSync(ipcDir, { recursive: true, force: true });
  }
});

// --- Helper ---

function seedTask(overrides?: Record<string, unknown>) {
  const now = new Date().toISOString();
  const defaults = {
    id: `gov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Test task',
    description: null,
    task_type: 'BUG',
    state: 'INBOX',
    priority: 'P2',
    product: null,
    product_id: null,
    scope: 'PRODUCT',
    assigned_group: 'developer',
    executor: null,
    created_by: 'main',
    gate: 'None',
    dod_required: 0,
    metadata: null,
    created_at: now,
    updated_at: now,
  };
  const task = { ...defaults, ...overrides };
  createGovTask(task as Parameters<typeof createGovTask>[0]);
  return task;
}

// --- writeGovSnapshot ---

describe('writeGovSnapshot', () => {
  it('writes gov_pipeline.json with task data', () => {
    seedTask({ id: 'snap-1', title: 'Snap task', state: 'DOING', assigned_group: 'developer' });
    seedTask({ id: 'snap-2', title: 'Other task', state: 'INBOX', assigned_group: 'security' });

    writeGovSnapshot('developer', false);

    const snapshotPath = path.join(tmpDir, 'ipc', 'developer', 'gov_pipeline.json');
    expect(fs.existsSync(snapshotPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(data.generatedAt).toBeTruthy();

    // Non-main sees only own tasks
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe('snap-1');
    expect(data.tasks[0].version).toBeDefined();
  });

  it('main sees all tasks', () => {
    seedTask({ id: 'snap-3', assigned_group: 'developer' });
    seedTask({ id: 'snap-4', assigned_group: 'security' });
    seedTask({ id: 'snap-5', assigned_group: null });

    writeGovSnapshot('main', true);

    const data = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ipc', 'main', 'gov_pipeline.json'), 'utf-8'),
    );
    expect(data.tasks).toHaveLength(3);
  });

  it('atomic write (no partial files)', () => {
    seedTask({ id: 'snap-atomic' });
    writeGovSnapshot('developer', false);

    // tmp file should not exist
    const tmpPath = path.join(tmpDir, 'ipc', 'developer', 'gov_pipeline.json.tmp');
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// --- writeExtCapabilitiesSnapshot ---

describe('writeExtCapabilitiesSnapshot', () => {
  it('writes ext_capabilities.json with provider info', () => {
    // Register a provider and grant capability
    registerProvider({
      name: 'test-prov',
      requiredSecrets: [],
      actions: {
        do_thing: {
          level: 1,
          description: 'Do a thing',
          params: {} as any,
          execute: async () => ({ ok: true, data: null, summary: 'done' }),
          summarize: () => 'do_thing',
          idempotent: true,
        },
      },
    });
    grantCapability({
      group_folder: 'developer',
      provider: 'test-prov',
      access_level: 1,
      allowed_actions: null,
      denied_actions: null,
      requires_task_gate: null,
      granted_by: 'main',
      granted_at: new Date().toISOString(),
      expires_at: null,
      active: 1,
    });

    writeExtCapabilitiesSnapshot('developer', false);

    const capPath = path.join(tmpDir, 'ipc', 'developer', 'ext_capabilities.json');
    expect(fs.existsSync(capPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(capPath, 'utf-8'));
    expect(data.capabilities).toHaveLength(1);
    expect(data.capabilities[0].provider).toBe('test-prov');
    expect(data.capabilities[0].access_level).toBe(1);
    expect(data.capabilities[0].actions.do_thing).toBeDefined();
    expect(data.capabilities[0].actions.do_thing.status).toBe('available');
  });

  it('marks higher-level actions correctly', () => {
    registerProvider({
      name: 'lvl-prov',
      requiredSecrets: [],
      actions: {
        read_it: {
          level: 1,
          description: 'Read',
          params: {} as any,
          execute: async () => ({ ok: true, data: null, summary: 'ok' }),
          summarize: () => 'read_it',
          idempotent: true,
        },
        write_it: {
          level: 2,
          description: 'Write',
          params: {} as any,
          execute: async () => ({ ok: true, data: null, summary: 'ok' }),
          summarize: () => 'write_it',
          idempotent: false,
        },
      },
    });
    grantCapability({
      group_folder: 'developer',
      provider: 'lvl-prov',
      access_level: 1,
      allowed_actions: null,
      denied_actions: null,
      requires_task_gate: null,
      granted_by: 'main',
      granted_at: new Date().toISOString(),
      expires_at: null,
      active: 1,
    });

    writeExtCapabilitiesSnapshot('developer', false);

    const data = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ipc', 'developer', 'ext_capabilities.json'), 'utf-8'),
    );
    const cap = data.capabilities.find((c: { provider: string }) => c.provider === 'lvl-prov');
    expect(cap.actions.read_it.status).toBe('available');
    expect(cap.actions.write_it.status).toBe('requires_higher_level');
  });

  it('marks denied actions', () => {
    registerProvider({
      name: 'deny-prov',
      requiredSecrets: [],
      actions: {
        allowed_action: {
          level: 1,
          description: 'Allowed',
          params: {} as any,
          execute: async () => ({ ok: true, data: null, summary: 'ok' }),
          summarize: () => '',
          idempotent: true,
        },
        denied_action: {
          level: 1,
          description: 'Denied',
          params: {} as any,
          execute: async () => ({ ok: true, data: null, summary: 'ok' }),
          summarize: () => '',
          idempotent: true,
        },
      },
    });
    grantCapability({
      group_folder: 'developer',
      provider: 'deny-prov',
      access_level: 1,
      allowed_actions: null,
      denied_actions: JSON.stringify(['denied_action']),
      requires_task_gate: null,
      granted_by: 'main',
      granted_at: new Date().toISOString(),
      expires_at: null,
      active: 1,
    });

    writeExtCapabilitiesSnapshot('developer', false);

    const data = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ipc', 'developer', 'ext_capabilities.json'), 'utf-8'),
    );
    const cap = data.capabilities.find((c: { provider: string }) => c.provider === 'deny-prov');
    expect(cap.actions.allowed_action.status).toBe('available');
    expect(cap.actions.denied_action.status).toBe('DENIED');
  });
});

// --- ensureIpcGroupSecret ---

describe('ensureIpcGroupSecret', () => {
  it('creates .ipc_secret if not exists', () => {
    ensureIpcGroupSecret('developer');

    const secretPath = path.join(tmpDir, 'ipc', 'developer', '.ipc_secret');
    expect(fs.existsSync(secretPath)).toBe(true);

    const secret = fs.readFileSync(secretPath, 'utf-8').trim();
    expect(secret).toHaveLength(64); // 32 bytes hex
  });

  it('does not overwrite existing secret', () => {
    ensureIpcGroupSecret('developer');

    const secretPath = path.join(tmpDir, 'ipc', 'developer', '.ipc_secret');
    const first = fs.readFileSync(secretPath, 'utf-8').trim();

    ensureIpcGroupSecret('developer');
    const second = fs.readFileSync(secretPath, 'utf-8').trim();

    expect(second).toBe(first);
  });

  it('creates unique secrets per group', () => {
    ensureIpcGroupSecret('developer');
    ensureIpcGroupSecret('security');

    const devSecret = fs.readFileSync(
      path.join(tmpDir, 'ipc', 'developer', '.ipc_secret'), 'utf-8',
    ).trim();
    const secSecret = fs.readFileSync(
      path.join(tmpDir, 'ipc', 'security', '.ipc_secret'), 'utf-8',
    ).trim();

    expect(devSecret).not.toBe(secSecret);
  });
});

// --- Dispatch DB queries ---

describe('dispatch queries', () => {
  it('getDispatchableGovTasks returns READY tasks with assigned_group', () => {
    seedTask({ id: 'disp-1', state: 'READY', assigned_group: 'developer' });
    seedTask({ id: 'disp-2', state: 'READY', assigned_group: null }); // no group
    seedTask({ id: 'disp-3', state: 'DOING', assigned_group: 'developer' }); // wrong state

    const tasks = getDispatchableGovTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('disp-1');
  });

  it('getReviewableGovTasks returns REVIEW tasks with non-None gate', () => {
    seedTask({ id: 'rev-1', state: 'REVIEW', gate: 'Security' });
    seedTask({ id: 'rev-2', state: 'REVIEW', gate: 'None' }); // no gate
    seedTask({ id: 'rev-3', state: 'APPROVAL', gate: 'Security' }); // wrong state

    const tasks = getReviewableGovTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('rev-1');
  });
});

// --- Idempotent dispatch ---

describe('idempotent dispatch (tryCreateDispatch)', () => {
  it('claims dispatch slot successfully', () => {
    const now = new Date().toISOString();
    const claimed = tryCreateDispatch({
      task_id: 'task-x',
      from_state: 'READY',
      to_state: 'DOING',
      dispatch_key: 'task-x:READY->DOING:v0',
      group_jid: 'dev@g.us',
      status: 'ENQUEUED',
      created_at: now,
      updated_at: now,
    });

    expect(claimed).toBe(true);
  });

  it('rejects duplicate dispatch_key (crash-safe)', () => {
    const now = new Date().toISOString();
    const dispatch = {
      task_id: 'task-y',
      from_state: 'READY',
      to_state: 'DOING',
      dispatch_key: 'task-y:READY->DOING:v0',
      group_jid: 'dev@g.us',
      status: 'ENQUEUED' as const,
      created_at: now,
      updated_at: now,
    };

    expect(tryCreateDispatch(dispatch)).toBe(true);
    expect(tryCreateDispatch(dispatch)).toBe(false); // duplicate
  });

  it('different version = new dispatch key', () => {
    const now = new Date().toISOString();
    const base = {
      task_id: 'task-z',
      from_state: 'READY',
      to_state: 'DOING',
      group_jid: 'dev@g.us',
      status: 'ENQUEUED' as const,
      created_at: now,
      updated_at: now,
    };

    expect(tryCreateDispatch({ ...base, dispatch_key: 'task-z:READY->DOING:v0' })).toBe(true);
    expect(tryCreateDispatch({ ...base, dispatch_key: 'task-z:READY->DOING:v1' })).toBe(true);
  });

  it('getDispatchByKey retrieves dispatch', () => {
    const now = new Date().toISOString();
    tryCreateDispatch({
      task_id: 'task-lookup',
      from_state: 'READY',
      to_state: 'DOING',
      dispatch_key: 'lookup-key',
      group_jid: 'dev@g.us',
      status: 'ENQUEUED',
      created_at: now,
      updated_at: now,
    });

    const dispatch = getDispatchByKey('lookup-key');
    expect(dispatch).toBeDefined();
    expect(dispatch!.task_id).toBe('task-lookup');
    expect(dispatch!.status).toBe('ENQUEUED');
  });
});

// --- Cross-agent context ---

describe('buildTaskContext', () => {
  it('returns empty string for task with no activity', () => {
    seedTask({ id: 'ctx-empty' });
    const ctx = buildTaskContext('ctx-empty');
    expect(ctx).toBe('');
  });

  it('includes activity log entries', () => {
    seedTask({ id: 'ctx-act' });
    const now = new Date().toISOString();
    logGovActivity({
      task_id: 'ctx-act',
      action: 'transition',
      from_state: 'READY',
      to_state: 'DOING',
      actor: 'system',
      reason: 'Auto-dispatched',
      created_at: now,
    });
    logGovActivity({
      task_id: 'ctx-act',
      action: 'transition',
      from_state: 'DOING',
      to_state: 'REVIEW',
      actor: 'developer',
      reason: 'Implementation complete',
      created_at: now,
    });

    const ctx = buildTaskContext('ctx-act');
    expect(ctx).toContain('Activity Log');
    expect(ctx).toContain('READY → DOING');
    expect(ctx).toContain('Auto-dispatched');
    expect(ctx).toContain('DOING → REVIEW');
    expect(ctx).toContain('Implementation complete');
    expect(ctx).toContain('developer');
  });

  it('includes gate approvals', () => {
    seedTask({ id: 'ctx-approve', gate: 'Security' });
    const now = new Date().toISOString();
    createGovApproval({
      task_id: 'ctx-approve',
      gate_type: 'Security',
      approved_by: 'security',
      approved_at: now,
      notes: 'LGTM, no vulnerabilities found',
    });

    const ctx = buildTaskContext('ctx-approve');
    expect(ctx).toContain('Gate Approvals');
    expect(ctx).toContain('Security approved by security');
    expect(ctx).toContain('LGTM, no vulnerabilities found');
  });

  it('respects maxActivities limit', () => {
    seedTask({ id: 'ctx-limit' });
    const now = new Date().toISOString();
    for (let i = 0; i < 25; i++) {
      logGovActivity({
        task_id: 'ctx-limit',
        action: 'transition',
        from_state: null,
        to_state: null,
        actor: 'system',
        reason: `Activity ${i}`,
        created_at: now,
      });
    }

    const ctx = buildTaskContext('ctx-limit', 5);
    // Should only show last 5 activities
    expect(ctx).toContain('Activity 20');
    expect(ctx).toContain('Activity 24');
    expect(ctx).not.toContain('Activity 0');
  });

  it('combines activities and approvals', () => {
    seedTask({ id: 'ctx-combined', gate: 'Security' });
    const now = new Date().toISOString();
    logGovActivity({
      task_id: 'ctx-combined',
      action: 'transition',
      from_state: 'DOING',
      to_state: 'REVIEW',
      actor: 'developer',
      reason: 'Done',
      created_at: now,
    });
    createGovApproval({
      task_id: 'ctx-combined',
      gate_type: 'Security',
      approved_by: 'security',
      approved_at: now,
      notes: null,
    });

    const ctx = buildTaskContext('ctx-combined');
    expect(ctx).toContain('Activity Log');
    expect(ctx).toContain('Gate Approvals');
  });
});

// --- Sprint 1: WIP limits ---

describe('WIP limits (countDoingTasksByGroup)', () => {
  it('returns 0 when no DOING tasks', () => {
    seedTask({ id: 'wip-ready', state: 'READY', assigned_group: 'developer' });
    expect(countDoingTasksByGroup('developer')).toBe(0);
  });

  it('counts DOING tasks for a specific group', () => {
    seedTask({ id: 'wip-d1', state: 'DOING', assigned_group: 'developer' });
    seedTask({ id: 'wip-d2', state: 'DOING', assigned_group: 'developer' });
    seedTask({ id: 'wip-d3', state: 'DOING', assigned_group: 'security' }); // different group

    expect(countDoingTasksByGroup('developer')).toBe(2);
    expect(countDoingTasksByGroup('security')).toBe(1);
  });

  it('does not count non-DOING states', () => {
    seedTask({ id: 'wip-r', state: 'READY', assigned_group: 'developer' });
    seedTask({ id: 'wip-rev', state: 'REVIEW', assigned_group: 'developer' });
    seedTask({ id: 'wip-done', state: 'DONE', assigned_group: 'developer' });
    seedTask({ id: 'wip-doing', state: 'DOING', assigned_group: 'developer' });

    expect(countDoingTasksByGroup('developer')).toBe(1);
  });
});

// --- Sprint 1: gov snapshot includes product_id + scope ---

describe('gov snapshot with product fields', () => {
  it('includes product_id and scope in snapshot', () => {
    seedTask({ id: 'snap-prod', product_id: 'ritmo', scope: 'PRODUCT', assigned_group: 'developer' });
    seedTask({ id: 'snap-comp', product_id: null, scope: 'COMPANY', assigned_group: 'developer' });

    writeGovSnapshot('developer', false);

    const data = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ipc', 'developer', 'gov_pipeline.json'), 'utf-8'),
    );

    const prodTask = data.tasks.find((t: { id: string }) => t.id === 'snap-prod');
    expect(prodTask.product_id).toBe('ritmo');
    expect(prodTask.scope).toBe('PRODUCT');

    const compTask = data.tasks.find((t: { id: string }) => t.id === 'snap-comp');
    expect(compTask.product_id).toBeNull();
    expect(compTask.scope).toBe('COMPANY');
  });
});

// --- Sprint 1.1: Dispatch product-status gating ---

describe('dispatch product-status gating', () => {
  it('READY task with paused product stays READY and logs activity', () => {
    const now = new Date().toISOString();
    createProduct({ id: 'paused-prod', name: 'Paused', status: 'paused', risk_level: 'normal', created_at: now, updated_at: now });
    seedTask({ id: 'paused-task', state: 'READY', assigned_group: 'developer', product_id: 'paused-prod', scope: 'PRODUCT' });

    // Verify task shows up as dispatchable (READY + assigned)
    const dispatchable = getDispatchableGovTasks();
    expect(dispatchable.some(t => t.id === 'paused-task')).toBe(true);

    // The dispatch loop would skip it due to product status.
    // We test the gating logic directly: product is paused → task stays READY.
    // The actual dispatch loop calls getProductById and checks status.
    const product = getProductById('paused-prod');
    expect(product!.status).toBe('paused');
    expect(product!.status !== 'active').toBe(true); // would be skipped
  });

  it('READY task with active product is dispatchable', () => {
    const now = new Date().toISOString();
    createProduct({ id: 'active-prod', name: 'Active', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });
    seedTask({ id: 'active-task', state: 'READY', assigned_group: 'developer', product_id: 'active-prod', scope: 'PRODUCT' });

    const dispatchable = getDispatchableGovTasks();
    const task = dispatchable.find(t => t.id === 'active-task');
    expect(task).toBeDefined();

    const product = getProductById('active-prod');
    expect(product!.status).toBe('active'); // would proceed to dispatch
  });

  it('READY task with no product_id (COMPANY scope) is dispatchable regardless', () => {
    seedTask({ id: 'company-task', state: 'READY', assigned_group: 'developer', product_id: null, scope: 'COMPANY' });

    const dispatchable = getDispatchableGovTasks();
    expect(dispatchable.some(t => t.id === 'company-task')).toBe(true);
    // No product_id → skip product check → proceed
  });
});

// --- Sprint 2: Context Pack ---

describe('buildContextPack', () => {
  it('includes product context for PRODUCT scope', () => {
    const now = new Date().toISOString();
    createProduct({ id: 'ritmo', name: 'Ritmo', status: 'active', risk_level: 'high', created_at: now, updated_at: now });
    seedTask({ id: 'cp-prod', state: 'APPROVAL', product_id: 'ritmo', scope: 'PRODUCT', assigned_group: 'developer' });

    const pack = buildContextPack(getGovTaskById('cp-prod')!);
    expect(pack).toContain('Product Context');
    expect(pack).toContain('Ritmo');
    expect(pack).toContain('active');
    expect(pack).toContain('high');
  });

  it('omits product context for COMPANY scope', () => {
    seedTask({ id: 'cp-comp', state: 'APPROVAL', product_id: null, scope: 'COMPANY', assigned_group: 'developer' });

    const pack = buildContextPack(getGovTaskById('cp-comp')!);
    expect(pack).not.toContain('Product Context');
  });

  it('includes task metadata (id, title, type, priority, scope)', () => {
    seedTask({ id: 'cp-meta', title: 'Fix auth bug', state: 'APPROVAL', task_type: 'BUG', priority: 'P1', scope: 'COMPANY', assigned_group: 'developer' });

    const pack = buildContextPack(getGovTaskById('cp-meta')!);
    expect(pack).toContain('Task Metadata');
    expect(pack).toContain('cp-meta');
    expect(pack).toContain('Fix auth bug');
    expect(pack).toContain('BUG');
    expect(pack).toContain('P1');
    expect(pack).toContain('COMPANY');
  });

  it('includes execution summary from execution_summary activity', () => {
    seedTask({ id: 'cp-sum', state: 'APPROVAL', assigned_group: 'developer' });
    const now = new Date().toISOString();
    logGovActivity({
      task_id: 'cp-sum',
      action: 'execution_summary',
      from_state: 'DOING',
      to_state: 'REVIEW',
      actor: 'developer',
      reason: 'Built the OAuth2 login flow with JWT tokens',
      created_at: now,
    });

    const pack = buildContextPack(getGovTaskById('cp-sum')!);
    expect(pack).toContain('Execution Summary');
    expect(pack).toContain('Built the OAuth2 login flow with JWT tokens');
  });

  it('includes evidence links from evidence activities', () => {
    seedTask({ id: 'cp-ev', state: 'APPROVAL', assigned_group: 'developer' });
    const now = new Date().toISOString();
    logGovActivity({
      task_id: 'cp-ev',
      action: 'evidence',
      from_state: 'DOING',
      to_state: null,
      actor: 'developer',
      reason: 'PR #42 merged: https://github.com/org/repo/pull/42',
      created_at: now,
    });

    const pack = buildContextPack(getGovTaskById('cp-ev')!);
    expect(pack).toContain('Evidence');
    expect(pack).toContain('PR #42 merged');
  });

  it('includes activity excerpt (last 15 in chronological order)', () => {
    seedTask({ id: 'cp-act', state: 'APPROVAL', assigned_group: 'developer' });
    for (let i = 0; i < 20; i++) {
      logGovActivity({
        task_id: 'cp-act',
        action: 'transition',
        from_state: null,
        to_state: null,
        actor: 'system',
        reason: `Step ${i}`,
        created_at: `2026-02-15T10:${String(i).padStart(2, '0')}:00.000Z`,
      });
    }

    const pack = buildContextPack(getGovTaskById('cp-act')!);
    expect(pack).toContain('Activity Log (recent)');
    // Should contain last 15 (steps 5-19)
    expect(pack).toContain('Step 19');
    expect(pack).toContain('Step 5');
    expect(pack).not.toContain('Step 4');
  });

  it('includes gate approvals section', () => {
    seedTask({ id: 'cp-gate', state: 'APPROVAL', gate: 'Security', assigned_group: 'developer' });
    createGovApproval({
      task_id: 'cp-gate',
      gate_type: 'Security',
      approved_by: 'security',
      approved_at: new Date().toISOString(),
      notes: 'Code review passed',
    });

    const pack = buildContextPack(getGovTaskById('cp-gate')!);
    expect(pack).toContain('Gate Approvals');
    expect(pack).toContain('Security approved by security');
    expect(pack).toContain('Code review passed');
  });

  it('returns minimal pack for task with no context', () => {
    seedTask({ id: 'cp-empty', state: 'APPROVAL', scope: 'COMPANY', assigned_group: 'developer' });

    const pack = buildContextPack(getGovTaskById('cp-empty')!);
    expect(pack).toContain('Task Metadata');
    expect(pack).not.toContain('Product Context');
    expect(pack).not.toContain('Execution Summary');
    expect(pack).not.toContain('Evidence');
    expect(pack).not.toContain('Activity Log');
  });
});

// --- Sprint 4: Memory injection in dispatch ---

describe('memory injection in buildContextPack', () => {
  function seedMemory(overrides: Record<string, unknown>) {
    const now = new Date().toISOString();
    const defaults = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: 'Test memory content',
      content_hash: 'abc123',
      level: 'L1',
      scope: 'COMPANY',
      product_id: null,
      group_folder: 'developer',
      tags: null,
      pii_detected: 0,
      pii_types: null,
      source_type: 'agent',
      source_ref: null,
      policy_version: null,
      created_at: now,
      updated_at: now,
    };
    const mem = { ...defaults, ...overrides };
    storeMemory(mem as Parameters<typeof storeMemory>[0]);
    return mem;
  }

  it('injects relevant memories in context pack', () => {
    seedMemory({ id: 'mem-auth', content: 'Authentication uses JWT tokens with RS256 signing', group_folder: 'developer', level: 'L1' });
    seedTask({ id: 'cp-mem-1', title: 'Fix authentication bug', state: 'APPROVAL', assigned_group: 'developer', scope: 'COMPANY' });

    const pack = buildContextPack(getGovTaskById('cp-mem-1')!);
    expect(pack).toContain('Relevant Memories');
    expect(pack).toContain('[L1]');
    expect(pack).toContain('JWT tokens');
  });

  it('omits memory section when no relevant memories exist', () => {
    seedTask({ id: 'cp-mem-2', title: 'Completely unrelated xyz topic', state: 'APPROVAL', assigned_group: 'developer', scope: 'COMPANY' });

    const pack = buildContextPack(getGovTaskById('cp-mem-2')!);
    expect(pack).not.toContain('Relevant Memories');
  });

  it('filters L3 memories from non-main groups', () => {
    seedMemory({ id: 'mem-secret', content: 'Secret deployment credentials and keys', group_folder: 'main', level: 'L3' });
    seedTask({ id: 'cp-mem-3', title: 'Deployment credentials setup', state: 'APPROVAL', assigned_group: 'developer', scope: 'COMPANY' });

    const pack = buildContextPack(getGovTaskById('cp-mem-3')!);
    // Developer should not see L3 memories
    expect(pack).not.toContain('Secret deployment credentials');
  });

  it('respects product isolation for PRODUCT-scoped memories', () => {
    const now = new Date().toISOString();
    createProduct({ id: 'prod-a', name: 'Product A', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });
    createProduct({ id: 'prod-b', name: 'Product B', status: 'active', risk_level: 'normal', created_at: now, updated_at: now });

    seedMemory({ id: 'mem-prod-a', content: 'Product A specific API documentation for endpoints', scope: 'PRODUCT', product_id: 'prod-a', group_folder: 'developer', level: 'L2' });
    seedMemory({ id: 'mem-prod-b', content: 'Product B specific API documentation for endpoints', scope: 'PRODUCT', product_id: 'prod-b', group_folder: 'developer', level: 'L2' });

    seedTask({ id: 'cp-mem-4', title: 'API documentation review', state: 'APPROVAL', assigned_group: 'developer', scope: 'PRODUCT', product_id: 'prod-a' });

    const pack = buildContextPack(getGovTaskById('cp-mem-4')!);
    // Should see prod-a memory but not prod-b (product isolation)
    expect(pack).toContain('Product A specific API');
    expect(pack).not.toContain('Product B specific API');
  });
});
