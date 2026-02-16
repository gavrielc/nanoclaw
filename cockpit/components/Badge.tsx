const STATE_COLORS: Record<string, string> = {
  INBOX: 'bg-zinc-700 text-zinc-200',
  TRIAGED: 'bg-blue-900 text-blue-200',
  READY: 'bg-cyan-900 text-cyan-200',
  DOING: 'bg-yellow-900 text-yellow-200',
  REVIEW: 'bg-purple-900 text-purple-200',
  APPROVAL: 'bg-orange-900 text-orange-200',
  DONE: 'bg-green-900 text-green-200',
  BLOCKED: 'bg-red-900 text-red-200',
  // Priorities
  P0: 'bg-red-900 text-red-200',
  P1: 'bg-orange-900 text-orange-200',
  P2: 'bg-yellow-900 text-yellow-200',
  P3: 'bg-zinc-700 text-zinc-200',
  // Product status
  active: 'bg-green-900 text-green-200',
  paused: 'bg-yellow-900 text-yellow-200',
  killed: 'bg-red-900 text-red-200',
  // Memory levels
  L0: 'bg-zinc-700 text-zinc-200',
  L1: 'bg-blue-900 text-blue-200',
  L2: 'bg-purple-900 text-purple-200',
  L3: 'bg-red-900 text-red-200',
  // Worker status
  online: 'bg-green-900 text-green-200',
  offline: 'bg-red-900 text-red-200',
  // Dispatch status
  ENQUEUED: 'bg-cyan-900 text-cyan-200',
  STARTED: 'bg-yellow-900 text-yellow-200',
  FAILED: 'bg-red-900 text-red-200',
};

export function Badge({ value }: { value: string }) {
  const colors = STATE_COLORS[value] || 'bg-zinc-700 text-zinc-200';
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {value}
    </span>
  );
}
