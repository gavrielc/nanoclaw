/**
 * Sprint 2 Acceptance — Mini-run Evidence Script
 *
 * Demonstrates the 3 acceptance criteria in-process:
 * 1. Product task DOING→REVIEW with execution summary (strict mode)
 * 2. Approval prompt contains Context Pack + Reviewer Contract
 * 3. ext_call logs product_id and scope
 */
import Database from 'better-sqlite3';
import { createGovSchema, createGovTask, logGovActivity, getGovActivitiesForContext, getGovTaskExecutionSummary, updateGovTask, getGovTaskById, createProduct } from '../src/gov-db.js';
import { createExtAccessSchema, logExtCall, getExtCallByRequestId } from '../src/ext-broker-db.js';
import { buildContextPack } from '../src/gov-loop.js';

const db = Database(':memory:');
createGovSchema(db);
createExtAccessSchema(db);

const now = new Date().toISOString();

// --- Setup: Create a product and a PRODUCT-scoped task ---
console.log('=== Sprint 2 Mini-Run Evidence ===\n');

createProduct({
  id: 'prod-acme',
  name: 'ACME SaaS',
  status: 'active',
  risk_level: 'high',
  description: 'Primary revenue product',
  created_at: now,
  updated_at: now,
});
console.log('1. Created product: ACME SaaS (active, high risk)');

const taskId = 'task-sprint2-evidence';
createGovTask({
  id: taskId,
  title: 'Implement payment retry logic',
  task_type: 'Feature',
  priority: 'P1',
  state: 'DOING',
  gate: 'Security',
  assigned_group: 'developer',
  executor: null,
  description: 'Add exponential backoff for failed Stripe charges',
  scope: 'PRODUCT',
  product_id: 'prod-acme',
  product: null,
  created_by: 'main',
  dod_required: 0,
  metadata: null,
  created_at: now,
  updated_at: now,
});
console.log('2. Created gov task: "Implement payment retry logic" (DOING, PRODUCT scope, product=ACME)');

// --- Evidence 1: DOING→REVIEW with execution summary ---
const reviewSummary = 'Implemented retry with exponential backoff (base 2s, max 5 retries). Unit tests cover all edge cases including partial refunds. No secrets in code path.';

// Simulate strict mode transition: log execution_summary + transition
logGovActivity({
  task_id: taskId,
  action: 'execution_summary',
  from_state: 'DOING',
  to_state: 'REVIEW',
  actor: 'developer',
  reason: reviewSummary,
  created_at: now,
});
logGovActivity({
  task_id: taskId,
  action: 'transition',
  from_state: 'DOING',
  to_state: 'REVIEW',
  actor: 'developer',
  reason: reviewSummary,
  created_at: now,
});
updateGovTask(taskId, 1, { state: 'REVIEW' });

const storedSummary = getGovTaskExecutionSummary(taskId);
console.log(`\n--- Evidence A: Execution Summary ---`);
console.log(`Stored summary: "${storedSummary}"`);
console.log(`Summary matches: ${storedSummary === reviewSummary ? 'YES ✓' : 'NO ✗'}`);

// --- Evidence 2: Context Pack in approval prompt ---
const task = getGovTaskById(taskId)!;
const contextPack = buildContextPack(task);
console.log(`\n--- Evidence B: Context Pack ---`);
console.log(contextPack);

const hasProductCtx = contextPack.includes('ACME SaaS');
const hasTaskMeta = contextPack.includes('Implement payment retry');
const hasExecSummary = contextPack.includes('exponential backoff');
const hasActivityLog = contextPack.includes('Activity Log');
console.log(`Contains product context: ${hasProductCtx ? 'YES ✓' : 'NO ✗'}`);
console.log(`Contains task metadata: ${hasTaskMeta ? 'YES ✓' : 'NO ✗'}`);
console.log(`Contains execution summary: ${hasExecSummary ? 'YES ✓' : 'NO ✗'}`);
console.log(`Contains activity log: ${hasActivityLog ? 'YES ✓' : 'NO ✗'}`);

// --- Evidence 3: ext_call logs product_id and scope ---
const requestId = 'ext-evidence-001';
logExtCall({
  request_id: requestId,
  group_folder: 'developer',
  provider: 'github',
  action: 'repo.list_prs',
  access_level: 1,
  params_hmac: 'test-hmac',
  params_summary: '{"repo":"Josuedutra/acme-saas"}',
  status: 'executed',
  denial_reason: null,
  result_summary: 'Listed 3 open PRs',
  response_data: null,
  task_id: taskId,
  idempotency_key: null,
  duration_ms: 250,
  created_at: now,
  product_id: 'prod-acme',
  scope: 'PRODUCT',
});

const extCall = getExtCallByRequestId(requestId)!;
console.log(`\n--- Evidence C: ext_call Product Scoping ---`);
console.log(`request_id: ${extCall.request_id}`);
console.log(`product_id: ${extCall.product_id}`);
console.log(`scope: ${extCall.scope}`);
console.log(`product_id stored: ${extCall.product_id === 'prod-acme' ? 'YES ✓' : 'NO ✗'}`);
console.log(`scope stored: ${extCall.scope === 'PRODUCT' ? 'YES ✓' : 'NO ✗'}`);

// --- Summary ---
const allPass = storedSummary === reviewSummary && hasProductCtx && hasTaskMeta && hasExecSummary && hasActivityLog && extCall.product_id === 'prod-acme' && extCall.scope === 'PRODUCT';
console.log(`\n=== ALL CHECKS: ${allPass ? 'PASS ✓' : 'FAIL ✗'} ===`);

db.close();
