'use client';

import { useState } from 'react';
import { Badge } from '@/components/Badge';
import { ErrorCallout } from '@/components/ErrorCallout';

interface Memory {
  id: string;
  content: string;
  level: string;
  scope: string;
  product_id: string | null;
  group_folder: string;
  tags: string | null;
  score?: number;
  created_at: string;
}

interface SearchResult {
  mode: 'semantic' | 'keyword';
  memories: Memory[];
  total_considered: number;
  access_denials: number;
}

export default function MemoryPage() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (scope) params.set('scope', scope);

      const res = await fetch(`/api/ops/memories/search?${params}`);
      if (res.status === 501) {
        setError('Memory system not enabled on host');
        setResult(null);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const memories = result?.memories ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Memory Search</h2>

      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories..."
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
        >
          <option value="">All Scopes</option>
          <option value="COMPANY">Company</option>
          <option value="PRODUCT">Product</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-zinc-700 px-4 py-1.5 text-sm hover:bg-zinc-600 disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <ErrorCallout message={error} />}

      {searched && result && (
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>
            Mode:{' '}
            <span className={result.mode === 'semantic' ? 'text-blue-400' : 'text-zinc-400'}>
              {result.mode}
            </span>
          </span>
          <span>{result.total_considered} considered</span>
          {result.access_denials > 0 && (
            <span className="text-yellow-500">{result.access_denials} denied</span>
          )}
        </div>
      )}

      {searched && memories.length === 0 && !error && (
        <p className="text-sm text-zinc-500">No memories found</p>
      )}

      {memories.length > 0 && (
        <div className="space-y-3">
          {memories.map((m) => {
            let tags: string[] = [];
            try {
              tags = m.tags ? JSON.parse(m.tags) : [];
            } catch {
              /* ignore */
            }

            return (
              <div
                key={m.id}
                className="rounded border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Badge value={m.level} />
                  <span className="text-xs text-zinc-500">{m.scope}</span>
                  <span className="text-xs text-zinc-600">
                    {m.group_folder}
                  </span>
                  {m.score !== undefined && (
                    <span className="text-xs text-blue-400">
                      {(m.score * 100).toFixed(1)}%
                    </span>
                  )}
                  <span className="ml-auto text-xs text-zinc-600">
                    {m.created_at}
                  </span>
                </div>
                <p className="text-sm text-zinc-300">
                  {m.content.length > 500
                    ? m.content.slice(0, 500) + '...'
                    : m.content}
                </p>
                {tags.length > 0 && (
                  <div className="mt-2 flex gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
