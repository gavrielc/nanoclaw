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
  createGovApproval,
  createGovTask,
  getDispatchableGovTasks,
  getDispatchByKey,
  getGovTaskById,
  getReviewableGovTasks,
  logGovActivity,
  tryCreateDispatch,
} from './gov-db.js';
import { grantCapability } from './ext-broker-db.js';
import { registerProvider } from './ext-broker-providers.js';
import {
  buildTaskContext,
  ensureIpcGroupSecret,
  writeExtCapabilitiesSnapshot,
  writeGovSnapshot,
} from './gov-loop.js';

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
