import { opsFetch } from '@/lib/ops-fetch';
import { Badge } from '@/components/Badge';
import { ErrorCallout } from '@/components/ErrorCallout';

interface TopKey {
  key: string;
  count: number;
}

interface Stats {
  tasks: {
    by_state: Array<{ state: string; count: number }>;
    by_product: Array<{
      product_id: string | null;
      product_name: string | null;
      count: number;
    }>;
  };
  ext_calls: {
    by_provider: Array<{ provider: string; count: number }>;
    l3_last_24h: Array<{
      request_id: string;
      provider: string;
      action: string;
      status: string;
      created_at: string;
    }>;
  };
  wip_load: Array<{ group: string; doing_count: number }>;
  failed_dispatches: Array<{
    task_id: string;
    dispatch_key: string;
    from_state: string;
    to_state: string;
    created_at: string;
  }>;
  top_keys?: {
    quota_used_today: TopKey[];
    denials_24h: TopKey[];
    ext_calls_24h: TopKey[];
    embeds_24h: TopKey[];
  };
}

export default async function Dashboard() {
  let stats: Stats;
  try {
    stats = await opsFetch<Stats>('/ops/stats');
  } catch (err) {
    return (
      <ErrorCallout
        message={err instanceof Error ? err.message : 'Failed to load stats'}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Dashboard</h2>

      {/* Tasks by State */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-400">
          Tasks by State
        </h3>
        <div className="flex flex-wrap gap-3">
          {stats.tasks.by_state.map((s) => (
            <div
              key={s.state}
              className="rounded border border-zinc-800 bg-zinc-950 px-4 py-3 text-center"
            >
              <Badge value={s.state} />
              <div className="mt-1 text-2xl font-bold">{s.count}</div>
            </div>
          ))}
          {stats.tasks.by_state.length === 0 && (
            <p className="text-sm text-zinc-500">No tasks</p>
          )}
        </div>
      </section>

      {/* WIP Load */}
      {stats.wip_load.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            WIP Load
          </h3>
          <div className="flex flex-wrap gap-3">
            {stats.wip_load.map((w) => (
              <div
                key={w.group}
                className="rounded border border-zinc-800 bg-zinc-950 px-4 py-3"
              >
                <div className="text-xs text-zinc-500">{w.group}</div>
                <div className="text-xl font-bold">{w.doing_count}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tasks by Product */}
      {stats.tasks.by_product.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            Tasks by Product
          </h3>
          <div className="flex flex-wrap gap-3">
            {stats.tasks.by_product.map((p) => (
              <div
                key={p.product_id ?? 'unassigned'}
                className="rounded border border-zinc-800 bg-zinc-950 px-4 py-3"
              >
                <div className="text-xs text-zinc-500">
                  {p.product_name || 'Unassigned'}
                </div>
                <div className="text-xl font-bold">{p.count}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ext Calls */}
      {stats.ext_calls.by_provider.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            External Calls
          </h3>
          <div className="flex flex-wrap gap-3">
            {stats.ext_calls.by_provider.map((e) => (
              <div
                key={e.provider}
                className="rounded border border-zinc-800 bg-zinc-950 px-4 py-3"
              >
                <div className="text-xs text-zinc-500">{e.provider}</div>
                <div className="text-xl font-bold">{e.count}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* L3 Calls (last 24h) */}
      {stats.ext_calls.l3_last_24h.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            L3 Calls (Last 24h)
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2">Provider</th>
                <th className="pb-2">Action</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {stats.ext_calls.l3_last_24h.map((c) => (
                <tr key={c.request_id} className="border-b border-zinc-800/50">
                  <td className="py-1.5">{c.provider}</td>
                  <td className="py-1.5">{c.action}</td>
                  <td className="py-1.5">
                    <Badge value={c.status} />
                  </td>
                  <td className="py-1.5 text-zinc-500">{c.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Failed Dispatches */}
      {stats.failed_dispatches.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-red-400">
            Failed Dispatches
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2">Task</th>
                <th className="pb-2">Transition</th>
                <th className="pb-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {stats.failed_dispatches.map((d) => (
                <tr key={d.dispatch_key} className="border-b border-zinc-800/50">
                  <td className="py-1.5 font-mono text-xs">{d.task_id}</td>
                  <td className="py-1.5">
                    {d.from_state} → {d.to_state}
                  </td>
                  <td className="py-1.5 text-zinc-500">{d.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Top Keys */}
      {stats.top_keys && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-zinc-400">
            Top Keys (24h)
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(
              [
                ['Quota Used Today', stats.top_keys.quota_used_today],
                ['Denials (24h)', stats.top_keys.denials_24h],
                ['Ext Calls (24h)', stats.top_keys.ext_calls_24h],
                ['Embeds (24h)', stats.top_keys.embeds_24h],
              ] as [string, TopKey[]][]
            ).map(([title, keys]) => (
              <div
                key={title}
                className="rounded border border-zinc-800 bg-zinc-950 p-3"
              >
                <div className="mb-2 text-xs font-semibold text-zinc-500">
                  {title}
                </div>
                {keys.length === 0 ? (
                  <p className="text-xs text-zinc-600">None</p>
                ) : (
                  <div className="space-y-1">
                    {keys.map((k) => (
                      <div
                        key={k.key}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="truncate font-mono text-zinc-400">
                          {k.key}
                        </span>
                        <span className="ml-2 font-bold">{k.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
