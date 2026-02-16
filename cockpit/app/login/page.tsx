'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorCallout } from '@/components/ErrorCallout';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }

      const data = await res.json();
      // Store CSRF token for write operations
      if (data.csrf) {
        sessionStorage.setItem('csrf', data.csrf);
      }

      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900">
      <div className="w-full max-w-sm space-y-6 rounded border border-zinc-800 bg-zinc-950 p-8">
        <h1 className="text-center text-xl font-bold text-white">
          NanoClaw Cockpit
        </h1>

        {error && <ErrorCallout message={error} />}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded bg-zinc-700 py-2 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
