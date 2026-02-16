import Link from 'next/link';
import { opsFetch } from '@/lib/ops-fetch';
import { Badge } from '@/components/Badge';
import { ErrorCallout } from '@/components/ErrorCallout';

interface Approval {
  task_id: string;
  gate_type: string;
  approved_by: string;
  approved_at: string;
  notes: string | null;
}

interface Activity {
  action: string;
  from_state: string | null;
  to_state: string | null;
  actor: string;
  reason: string | null;
  created_at: string;
}

interface EnrichedTask {
  id: string;
  title: string;
  task_type: string;
  priority: string;
  gate: string;
  product: string | null;
  assigned_group: string | null;
  approvals: Approval[];
  execution_summary: string | null;
  recent_activities: Activity[];
}

export default async function ApprovalsPage() {
  let tasks: EnrichedTask[];
  try {
    tasks = await opsFetch<EnrichedTask[]>('/ops/approvals');
  } catch (err) {
    return (
      <ErrorCallout
        message={err instanceof Error ? err.message : 'Failed to load approvals'}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Pending Approvals</h2>

      {tasks.length === 0 && (
        <p className="text-sm text-zinc-500">No tasks awaiting approval</p>
      )}

      <div className="space-y-4">
        {tasks.map((t) => (
          <Link
            key={t.id}
            href={`/tasks/${encodeURIComponent(t.id)}`}
            className="block rounded border border-zinc-800 bg-zinc-950 p-4 hover:border-zinc-700"
          >
            <div className="flex items-center gap-2">
              <Badge value={t.priority} />
              <Badge value={t.task_type} />
              <span className="font-medium">{t.title}</span>
              {t.gate !== 'None' && (
                <span className="ml-auto rounded bg-amber-900/30 px-2 py-0.5 text-xs text-amber-400">
                  Gate: {t.gate}
                </span>
              )}
            </div>

            {t.execution_summary && (
              <p className="mt-2 text-sm text-zinc-400">
                {t.execution_summary.length > 200
                  ? t.execution_summary.slice(0, 200) + '...'
                  : t.execution_summary}
              </p>
            )}

            <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
              {t.assigned_group && <span>Group: {t.assigned_group}</span>}
              {t.product && <span>Product: {t.product}</span>}
              {t.approvals.length > 0 && (
                <span className="text-green-500">
                  {t.approvals.length} approval(s)
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
