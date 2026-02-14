import fs from 'fs';
import path from 'path';
import pino from 'pino';

const isTui = process.env.NANOCLAW_TUI === '1';

const logDir = process.env.NANOCLAW_LOG_DIR || path.join(process.cwd(), 'log');
if (isTui) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'nanoclaw.log');

export const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  isTui
    ? pino.destination(logFile)
    : pino.transport({ target: 'pino-pretty', options: { colorize: true } }),
);

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
