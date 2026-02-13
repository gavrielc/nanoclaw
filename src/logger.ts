import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});

// --- LogBuffer: in-memory ring buffer for the WebUI logs API ---

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  [key: string]: unknown;
}

const LOG_BUFFER_SIZE = 2000;

class LogBuffer {
  private buffer: LogEntry[] = [];
  private writeIndex = 0;
  private full = false;

  push(entry: LogEntry): void {
    this.buffer[this.writeIndex] = entry;
    this.writeIndex = (this.writeIndex + 1) % LOG_BUFFER_SIZE;
    if (this.writeIndex === 0) this.full = true;
  }

  getEntries(level?: number, limit?: number): LogEntry[] {
    let entries: LogEntry[];
    if (this.full) {
      entries = [
        ...this.buffer.slice(this.writeIndex),
        ...this.buffer.slice(0, this.writeIndex),
      ];
    } else {
      entries = this.buffer.slice(0, this.writeIndex);
    }
    if (level !== undefined) {
      entries = entries.filter((e) => e.level >= level);
    }
    if (limit !== undefined && limit > 0) {
      entries = entries.slice(-limit);
    }
    return entries;
  }

  get size(): number {
    return this.full ? LOG_BUFFER_SIZE : this.writeIndex;
  }
}

export const logBuffer = new LogBuffer();

// Intercept pino writes to capture into the buffer.
// pino-pretty transport runs in a worker thread, so we add a second
// destination that feeds the ring buffer in the main thread.
const origWrite = process.stdout.write.bind(process.stdout);
const pinoRaw = pino({ level: process.env.LOG_LEVEL || 'info' });
// We hook into pino by adding a custom destination wrapper.
// Instead of modifying pino internals, we use a simpler approach:
// periodically-flushed write hook on the raw logger.
// Actually, the simplest approach: wrap logger methods.
const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
const levelNumbers: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

for (const lvl of levels) {
  const original = (logger as any)[lvl].bind(logger);
  (logger as any)[lvl] = function (...args: any[]) {
    // Capture to buffer
    const entry: LogEntry = {
      level: levelNumbers[lvl],
      time: Date.now(),
      msg: '',
    };
    if (typeof args[0] === 'string') {
      entry.msg = args[0];
    } else if (typeof args[0] === 'object' && args[0] !== null) {
      Object.assign(entry, args[0]);
      if (typeof args[1] === 'string') entry.msg = args[1];
    }
    logBuffer.push(entry);
    // Call original
    return original(...args);
  };
}
