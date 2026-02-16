import Link from 'next/link';
import { opsFetch } from '@/lib/ops-fetch';
import { Badge } from '@/components/Badge';

interface WorkerDetail {
  id: string;
  ssh_host: string;
  ssh_user: string;
  ssh_port: number;
  local_port: number;
  remote_port: number;
  status: string;
  max_wip: number;
  current_wip: number;
  tunnel_up: boolean;
  groups_json: string | null;
  callback_url: string | null;
  created_at: string;
  updated_at: string;
}

interface Dispatch {
  id: number;
  task_id: string;
  from_state: string;
  to_state: string;
  dispatch_key: string;
  status: string;
  worker_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TunnelInfo {
  worker_id: string;
  tunnel_up: boolean;
  local_port: number;
  remote_port: number;
}

export default async function WorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let worker: WorkerDetail | null = null;
  let dispatches: Dispatch[] = [];
  let tunnel: TunnelInfo | null = null;
  let error = '';

  try {
    [worker, dispatches, tunnel] = await Promise.all([
      opsFetch<WorkerDetail>(`/ops/workers/${encodeURIComponent(id)}`),
      opsFetch<Dispatch[]>(
        `/ops/workers/${encodeURIComponent(id)}/dispatches`,
        { limit: '20' },
      ),
      opsFetch<TunnelInfo>(
        `/ops/workers/${encodeURIComponent(id)}/tunnels`,
      ),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load worker';
  }

  if (error || !worker) {
    return (
      <div>
        <Link href="/workers" className="text-sm text-blue-400 hover:underline">
          &larr; Workers
        </Link>
        <p className="mt-4 rounded bg-red-900/50 px-3 py-2 text-red-200 text-sm">
          {error || 'Worker not found'}
        </p>
      </div>
    );
  }

  let groups: string[] = [];
  try {
    if (worker.groups_json) groups = JSON.parse(worker.groups_json);
  } catch { /* ignore */ }

  return (
    <div>
      <Link href="/workers" className="text-sm text-blue-400 hover:underline">
        &larr; Workers
      </Link>

      <h1 className="mt-3 mb-4 text-xl font-bold">{worker.id}</h1>

      {/* Worker metadata */}
      <div className="mb-6 grid grid-cols-2 gap-4 rounded border border-zinc-800 bg-zinc-950 p-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-zinc-500">Status</div>
          <Badge value={worker.status} />
        </div>
        <div>
          <div className="text-zinc-500">Tunnel</div>
          <span className={worker.tunnel_up ? 'text-green-400' : 'text-red-400'}>
            {worker.tunnel_up ? 'UP' : 'DOWN'}
          </span>
        </div>
        <div>
          <div className="text-zinc-500">WIP</div>
          <span className="text-zinc-200">
            {worker.current_wip} / {worker.max_wip}
          </span>
        </div>
        <div>
          <div className="text-zinc-500">Host</div>
          <span className="text-zinc-200">
            {worker.ssh_user}@{worker.ssh_host}:{worker.ssh_port}
          </span>
        </div>
        <div>
          <div className="text-zinc-500">Local Port</div>
          <span className="text-zinc-200">{worker.local_port}</span>
        </div>
        <div>
          <div className="text-zinc-500">Remote Port</div>
          <span className="text-zinc-200">{worker.remote_port}</span>
        </div>
        <div>
          <div className="text-zinc-500">Groups</div>
          <span className="text-zinc-200">
            {groups.length > 0 ? groups.join(', ') : 'none'}
          </span>
        </div>
        <div>
          <div className="text-zinc-500">Last Updated</div>
          <span className="text-zinc-200">
            {new Date(worker.updated_at).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Tunnel info */}
      {tunnel && (
        <div className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Tunnel</h2>
          <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-sm">
            <span className="text-zinc-400">
              localhost:{tunnel.local_port} &rarr; 127.0.0.1:{tunnel.remote_port}
            </span>
            <span className="ml-3">
              {tunnel.tunnel_up ? (
                <span className="text-green-400">Connected</span>
              ) : (
                <span className="text-red-400">Disconnected</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Recent dispatches */}
      <h2 className="mb-2 text-lg font-semibold">Recent Dispatches</h2>
      {dispatches.length === 0 ? (
        <p className="text-sm text-zinc-400">No dispatches to this worker yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-400">
                <th className="pb-2 pr-4">Task</th>
                <th className="pb-2 pr-4">Transition</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {dispatches.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                >
                  <td className="py-2 pr-4">
                    <Link
                      href={`/tasks/${d.task_id}`}
                      className="text-blue-400 hover:underline"
                    >
                      {d.task_id}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-zinc-300">
                    {d.from_state} &rarr; {d.to_state}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge value={d.status} />
                  </td>
                  <td className="py-2 text-zinc-400">
                    {new Date(d.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
