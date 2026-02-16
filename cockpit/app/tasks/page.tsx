import Link from 'next/link';
import { opsFetch } from '@/lib/ops-fetch';
import { Badge } from '@/components/Badge';
import { ErrorCallout } from '@/components/ErrorCallout';

interface Task {
  id: string;
  title: string;
  state: string;
  priority: string;
  task_type: string;
  product: string | null;
  product_id: string | null;
  assigned_group: string | null;
  updated_at: string;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const params: Record<string, string> = {};
  if (sp.state) params.state = sp.state;
  if (sp.type) params.type = sp.type;
  if (sp.product_id) params.product_id = sp.product_id;

  let tasks: Task[];
  try {
    tasks = await opsFetch<Task[]>('/ops/tasks', params);
  } catch (err) {
    return (
      <ErrorCallout
        message={err instanceof Error ? err.message : 'Failed to load tasks'}
      />
    );
  }

  const states = [
    'INBOX',
    'TRIAGED',
    'READY',
    'DOING',
    'REVIEW',
    'APPROVAL',
    'DONE',
    'BLOCKED',
  ];
  const types = [
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
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Tasks</h2>

      {/* Filters */}
      <form className="flex gap-3">
        <select
          name="state"
          defaultValue={sp.state || ''}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
        >
          <option value="">All States</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={sp.type || ''}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
        >
          <option value="">All Types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded bg-zinc-700 px-4 py-1.5 text-sm hover:bg-zinc-600"
        >
          Filter
        </button>
      </form>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="pb-2">Title</th>
            <th className="pb-2">State</th>
            <th className="pb-2">Priority</th>
            <th className="pb-2">Type</th>
            <th className="pb-2">Product</th>
            <th className="pb-2">Group</th>
            <th className="pb-2">Updated</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr
              key={t.id}
              className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
            >
              <td className="py-2">
                <Link
                  href={`/tasks/${t.id}`}
                  className="text-blue-400 hover:underline"
                >
                  {t.title}
                </Link>
              </td>
              <td className="py-2">
                <Badge value={t.state} />
              </td>
              <td className="py-2">
                <Badge value={t.priority} />
              </td>
              <td className="py-2 text-zinc-400">{t.task_type}</td>
              <td className="py-2 text-zinc-400">{t.product || '-'}</td>
              <td className="py-2 text-zinc-400">
                {t.assigned_group || '-'}
              </td>
              <td className="py-2 text-zinc-500 text-xs">{t.updated_at}</td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-zinc-500">
                No tasks found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
