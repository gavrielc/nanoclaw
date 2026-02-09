import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import { AgentResult, runAgent } from './agent.js';
import {
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTaskAfterRun,
} from './db.js';
import { logger } from './logger.js';
import { ScheduledTask } from './types.js';

export interface SchedulerDependencies {
  getSessions: () => Record<string, string>;
  sendMessage: (jid: string, text: string) => Promise<void>;
  assistantName: string;
  acquireLock: () => boolean;
  releaseLock: () => void;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();

  logger.info({ taskId: task.id, chatJid: task.chat_jid }, 'Running scheduled task');

  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'chat' ? sessions[task.chat_jid] : undefined;

  let result: string | null = null;
  let error: string | null = null;

  try {
    const output = await runAgent(task.prompt, task.chat_jid, {
      sessionId,
      isScheduledTask: true,
      onResult: async (streamedOutput: AgentResult) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          const text = streamedOutput.result.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          if (text) {
            await deps.sendMessage(task.chat_jid, `${deps.assistantName}: ${text}`);
          }
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    });

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  let nextRun: string | null = null;
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    nextRun = interval.next().toISOString();
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    nextRun = new Date(Date.now() + ms).toISOString();
  }

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        // Only run task if no agent is currently active
        if (!deps.acquireLock()) {
          logger.debug({ taskId: task.id }, 'Agent busy, task deferred');
          break;
        }

        try {
          await runTask(currentTask, deps);
        } finally {
          deps.releaseLock();
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}
