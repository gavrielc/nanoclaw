// Ported from Mission Control — adapted for NanoClaw Orchestration Kernel v0

export const TaskTypes = [
  'EPIC',
  'FEATURE',
  'BUG',
  'SECURITY',
  'REVOPS',
  'OPS',
  'RESEARCH',
  'CONTENT',
  'DOC',
  'INCIDENT',
] as const;
export type TaskType = (typeof TaskTypes)[number];

export const TaskPriorities = ['P0', 'P1', 'P2', 'P3'] as const;
export type TaskPriority = (typeof TaskPriorities)[number];

export const TaskStates = [
  'INBOX',
  'TRIAGED',
  'READY',
  'DOING',
  'REVIEW',
  'APPROVAL',
  'DONE',
  'BLOCKED',
] as const;
export type TaskState = (typeof TaskStates)[number];

export const GateTypes = ['None', 'Security', 'RevOps', 'Claims', 'Product'] as const;
export type GateType = (typeof GateTypes)[number];

export const GovScopes = ['COMPANY', 'PRODUCT'] as const;
export type GovScope = (typeof GovScopes)[number];

export const ProductStatuses = ['active', 'paused', 'killed'] as const;
export type ProductStatus = (typeof ProductStatuses)[number];

export const RiskLevels = ['low', 'normal', 'high'] as const;
export type RiskLevel = (typeof RiskLevels)[number];

// --- SQLite row types ---

export interface Product {
  id: string;
  name: string;
  status: ProductStatus;
  risk_level: RiskLevel;
  created_at: string;
  updated_at: string;
}

export interface GovTask {
  id: string;
  title: string;
  description: string | null;
  task_type: string;
  state: TaskState;
  priority: string;
  /** @deprecated Use product_id instead. Kept for backward compatibility. */
  product: string | null;
  product_id: string | null;
  scope: GovScope;
  assigned_group: string | null;
  executor: string | null;
  created_by: string;
  gate: string;
  dod_required: number; // 0 or 1
  version: number;
  metadata: string | null; // JSON for extensible fields
  created_at: string;
  updated_at: string;
}

export interface GovActivity {
  task_id: string;
  action: string; // create, transition, approve, override, assign
  from_state: string | null;
  to_state: string | null;
  actor: string;
  reason: string | null;
  created_at: string;
}

export interface GovApproval {
  task_id: string;
  gate_type: string;
  approved_by: string;
  approved_at: string;
  notes: string | null;
}

export interface GovDispatch {
  task_id: string;
  from_state: string;
  to_state: string;
  dispatch_key: string;
  group_jid: string;
  status: 'ENQUEUED' | 'STARTED' | 'DONE' | 'FAILED';
  worker_id?: string;
  created_at: string;
  updated_at: string;
}
