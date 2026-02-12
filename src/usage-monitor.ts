import type Database from 'better-sqlite3';

export interface UsageEntry {
  phone?: string;
  complaint_id?: string;
  model: string;
  purpose: string;
  container_duration_ms?: number;
}

export interface UsageStats {
  totalMessages: number;
  containerRuns: number;
  avgDurationMs: number;
  byModel: Record<string, number>;
}

export function logUsage(db: Database.Database, entry: UsageEntry): void {
  db.prepare(
    `INSERT INTO usage_log (phone, complaint_id, model, purpose, container_duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.phone ?? null,
    entry.complaint_id ?? null,
    entry.model,
    entry.purpose,
    entry.container_duration_ms ?? null,
    new Date().toISOString(),
  );
}

export function getUsageStats(db: Database.Database, date: string): UsageStats {
  const totalRow = db
    .prepare(`SELECT COUNT(*) as c FROM usage_log WHERE DATE(created_at) = ?`)
    .get(date) as { c: number };

  const containerRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM usage_log WHERE container_duration_ms IS NOT NULL AND DATE(created_at) = ?`,
    )
    .get(date) as { c: number };

  const avgRow = db
    .prepare(
      `SELECT AVG(container_duration_ms) as avg FROM usage_log WHERE container_duration_ms IS NOT NULL AND DATE(created_at) = ?`,
    )
    .get(date) as { avg: number | null };

  const modelRows = db
    .prepare(
      `SELECT model, COUNT(*) as c FROM usage_log WHERE DATE(created_at) = ? GROUP BY model`,
    )
    .all(date) as Array<{ model: string; c: number }>;

  const byModel: Record<string, number> = {};
  for (const row of modelRows) {
    byModel[row.model] = row.c;
  }

  return {
    totalMessages: totalRow.c,
    containerRuns: containerRow.c,
    avgDurationMs: avgRow.avg ?? 0,
    byModel,
  };
}

export function formatUsageSection(stats: UsageStats): string {
  const lines: string[] = [];
  lines.push('\u{1F4CA} Usage');
  lines.push(`  Messages: ${stats.totalMessages}`);
  lines.push(`  Agent Runs: ${stats.containerRuns}`);
  if (stats.containerRuns > 0) {
    const seconds = (stats.avgDurationMs / 1000).toFixed(1);
    lines.push(`  Avg Duration: ${seconds}s`);
  }

  const models = Object.entries(stats.byModel)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');
  if (models) {
    lines.push(`  Models: ${models}`);
  }

  return lines.join('\n');
}
