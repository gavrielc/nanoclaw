/**
 * The first-chat step's lines: intro, stages, the keep-waiting question and
 * the skip note. Each is a whole sentence with named placeholders filled by
 * fill(), so a translation can reorder it. Failure notes live with the ping
 * in agent-ping.ts.
 */
import type { FirstChatStage } from './first-chat-progress.js';

export const SLOW_MODEL = 'A local model can take several minutes to load and read its first prompt.';
export const CHAT_LATER = 'Chat with it later using `pnpm run chat hi`.';
const LOG_HINT = 'If it never answers, check `logs/nanoclaw.log`.';

interface StageCopy {
  running: string;
  done: string;
  stillWaiting: string;
  skipped: string;
}

export const FIRST_CHAT_COPY = {
  intro:
    "Your assistant runs in an isolated sandbox. I'm going to send it a quick test message (ping) and wait for a reply (pong) to confirm it's responding. First startup typically takes 30–60 seconds while the sandbox warms up.",
  skippedTitle: 'Skipping the first chat',
  waking: 'Waking your assistant…',
  ready: 'Your assistant is ready.',
  replied: 'Your assistant replied.',
  waitEnded: 'The wait ended.',
  stoppedWaiting: 'Stopped waiting for the first reply.',
  slowModelHint: SLOW_MODEL,
  keepWaiting: 'Keep waiting',
  keepWaitingHint: `{minutes} more minutes. ${SLOW_MODEL}`,
  skip: 'Skip the first chat and finish setup',
  skipHint: CHAT_LATER,
  stillWaitingUnseen: 'Still waiting for a reply after {time}. Keep waiting?',
  skippedUnseen: 'Your assistant had not replied when you stopped waiting.',
  skippedNext: `Setup carries on without the first chat. ${CHAT_LATER} ${LOG_HINT}`,
  stages: {
    sending: {
      running: 'Sending a test message…',
      done: 'Test message received',
      stillWaiting: 'Still sending the test message after {time}. Keep waiting?',
      skipped: 'Your assistant was still sending the test message when you stopped waiting.',
    },
    starting_sandbox: {
      running: 'Starting the sandbox…',
      done: 'Sandbox started',
      stillWaiting: 'Still starting the sandbox after {time}. Keep waiting?',
      skipped: 'Your assistant was still starting the sandbox when you stopped waiting.',
    },
    starting_agent: {
      running: 'Starting the agent runtime…',
      done: 'Agent runtime started',
      stillWaiting: 'Still starting the agent runtime after {time}. Keep waiting?',
      skipped: 'Your assistant was still starting the agent runtime when you stopped waiting.',
    },
    waiting_for_reply: {
      running: "Waiting for the model's first reply…",
      done: 'Reply received',
      stillWaiting: "Still waiting for the model's first reply after {time}. Keep waiting?",
      skipped: "Your assistant was still waiting for the model's first reply when you stopped waiting.",
    },
  } satisfies Record<FirstChatStage, StageCopy>,
};

/** Fill {name} placeholders; an unknown one stays visible rather than vanishing. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}
