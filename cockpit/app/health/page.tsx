import { opsFetch } from '@/lib/ops-fetch';
import { ErrorCallout } from '@/components/ErrorCallout';

interface HealthData {
  status: string;
  uptime_seconds: number;
  version: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export default async function HealthPage() {
  let health: HealthData;
  let error: string | null = null;

  try {
    health = await opsFetch<HealthData>('/ops/health');
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to reach host';
    health = { status: 'unreachable', uptime_seconds: 0, version: '-' };
  }

  const ok = health.status === 'ok' && !error;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Health</h2>

      {error && <ErrorCallout message={error} />}

      <div className="rounded border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div
            className={`h-4 w-4 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className="text-lg font-semibold">
            {ok ? 'Healthy' : 'Unreachable'}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-zinc-500">Status</dt>
            <dd className="font-medium">{health.status}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Uptime</dt>
            <dd className="font-medium">
              {formatUptime(health.uptime_seconds)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Policy Version</dt>
            <dd className="font-medium">{health.version}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Host URL</dt>
            <dd className="font-mono text-xs text-zinc-400">
              {process.env.OS_HOST_URL || 'http://localhost:7700'}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
