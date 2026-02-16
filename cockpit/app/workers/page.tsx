import Link from 'next/link';
import { opsFetch } from '@/lib/ops-fetch';
import { Badge } from '@/components/Badge';

interface WorkerSummary {
  id: string;
  ssh_host: string;
  ssh_user: string;
  status: string;
  max_wip: number;
  current_wip: number;
  tunnel_up: boolean;
  groups_json: string | null;
  updated_at: string;
}

export default async function WorkersPage() {
  let workers: WorkerSummary[] = [];
  let error = '';

  try {
    workers = await opsFetch<WorkerSummary[]>('/ops/workers');
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load workers';
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Workers</h1>

      {error && (
        <p className="mb-4 rounded bg-red-900/50 px-3 py-2 text-red-200 text-sm">
          {error}
        </p>
      )}

      {workers.length === 0 && !error && (
        <p className="text-sm text-zinc-400">
          No workers registered. Workers are optional — tasks dispatch locally
          when no workers are configured.
        </p>
      )}

      {workers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-400">
                <th className="pb-2 pr-4">ID</th>
                <th className="pb-2 pr-4">Host</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Tunnel</th>
                <th className="pb-2 pr-4">WIP</th>
                <th className="pb-2 pr-4">Groups</th>
                <th className="pb-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => {
                let groups: string[] = [];
                try {
                  if (w.groups_json) groups = JSON.parse(w.groups_json);
                } catch { /* ignore */ }

                return (
                  <tr
                    key={w.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="py-2 pr-4">
                      <Link
                        href={`/workers/${w.id}`}
                        className="text-blue-400 hover:underline"
                      >
                        {w.id}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-300">
                      {w.ssh_user}@{w.ssh_host}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge value={w.status} />
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          w.tunnel_up ? 'bg-green-500' : 'bg-red-500'
                        }`}
                        title={w.tunnel_up ? 'Tunnel up' : 'Tunnel down'}
                      />
                      <span className="ml-1.5 text-zinc-400">
                        {w.tunnel_up ? 'up' : 'down'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-zinc-300">
                      {w.current_wip}/{w.max_wip}
                    </td>
                    <td className="py-2 pr-4">
                      {groups.length > 0 ? (
                        <span className="text-zinc-300">
                          {groups.join(', ')}
                        </span>
                      ) : (
                        <span className="text-zinc-500">none</span>
                      )}
                    </td>
                    <td className="py-2 text-zinc-400">
                      {new Date(w.updated_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
