/**
 * Container Runner for NanoClaw
 * Spawns agent execution in Apple Container and handles IPC
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import {
  CONTAINER_IMAGE,
  CONTAINER_TIMEOUT,
  GROUPS_DIR,
  DATA_DIR
} from './config.js';
import { RegisteredGroup } from './types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

function buildVolumeMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const homeDir = process.env.HOME || '/Users/gavriel';
  const projectRoot = process.cwd();

  if (isMain) {
    // Main gets the entire project root mounted
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: false
    });

    // Main also gets its group folder as the working directory
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false
    });
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false
    });

    // Global memory directory (read-only for non-main)
    // Apple Container only supports directory mounts, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true
      });
    }
  }

  // Claude sessions directory (for session persistence)
  // Container runs as 'node' user with HOME=/home/node
  const claudeDir = path.join(homeDir, '.claude');
  if (fs.existsSync(claudeDir)) {
    mounts.push({
      hostPath: claudeDir,
      containerPath: '/home/node/.claude',
      readonly: false
    });
  }

  const gmailDir = path.join(homeDir, '.gmail-mcp');
  if (fs.existsSync(gmailDir)) {
    mounts.push({
      hostPath: gmailDir,
      containerPath: '/home/node/.gmail-mcp',
      readonly: false
    });
  }

  const ipcDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(path.join(ipcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'tasks'), { recursive: true });
  mounts.push({
    hostPath: ipcDir,
    containerPath: '/workspace/ipc',
    readonly: false
  });

  // Environment file directory (workaround for Apple Container -i env var bug)
  // Only expose specific auth variables needed by Claude Code, not the entire .env
  const envDir = path.join(DATA_DIR, 'env');
  fs.mkdirSync(envDir, { recursive: true });
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
    const filteredLines = envContent
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return false;
        return allowedVars.some(v => trimmed.startsWith(`${v}=`));
      });

    if (filteredLines.length > 0) {
      fs.writeFileSync(path.join(envDir, 'env'), filteredLines.join('\n') + '\n');
      mounts.push({
        hostPath: envDir,
        containerPath: '/workspace/env-dir',
        readonly: true
      });
    }
  }

  if (group.containerConfig?.additionalMounts) {
    for (const mount of group.containerConfig.additionalMounts) {
      const hostPath = mount.hostPath.startsWith('~')
        ? path.join(homeDir, mount.hostPath.slice(1))
        : mount.hostPath;

      if (fs.existsSync(hostPath)) {
        mounts.push({
          hostPath,
          containerPath: `/workspace/extra/${mount.containerPath}`,
          readonly: mount.readonly !== false // Default to readonly for safety
        });
      } else {
        logger.warn({ hostPath }, 'Additional mount path does not exist, skipping');
      }
    }
  }

  return mounts;
}

function buildContainerArgs(mounts: VolumeMount[]): string[] {
  const args: string[] = ['run', '-i', '--rm'];

  // Apple Container: --mount for readonly, -v for read-write
  for (const mount of mounts) {
    if (mount.readonly) {
      args.push('--mount', `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`);
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const containerArgs = buildContainerArgs(mounts);

  logger.debug({
    group: group.name,
    mounts: mounts.map(m => `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`),
    containerArgs: containerArgs.join(' ')
  }, 'Container mount configuration');

  logger.info({
    group: group.name,
    mountCount: mounts.length,
    isMain: input.isMain
  }, 'Spawning container agent');

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn('container', containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    container.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    container.stderr.on('data', (data) => {
      stderr += data.toString();
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
    });

    const timeout = setTimeout(() => {
      logger.error({ group: group.name }, 'Container timeout, killing');
      container.kill('SIGKILL');
      resolve({
        status: 'error',
        result: null,
        error: `Container timed out after ${CONTAINER_TIMEOUT}ms`
      });
    }, group.containerConfig?.timeout || CONTAINER_TIMEOUT);

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        ``
      ];

      if (isVerbose) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts.map(m => `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`).join('\n'),
          ``,
          `=== Stderr ===`,
          stderr,
          ``,
          `=== Stdout ===`,
          stdout
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
          `=== Mounts ===`,
          mounts.map(m => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`).join('\n'),
          ``
        );

        if (code !== 0) {
          logLines.push(
            `=== Stderr (last 500 chars) ===`,
            stderr.slice(-500),
            ``
          );
        }
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        logger.error({
          group: group.name,
          code,
          duration,
          stderr: stderr.slice(-500),
          logFile
        }, 'Container exited with error');

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`
        });
        return;
      }

      try {
        // Last non-empty line is the JSON output
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info({
          group: group.name,
          duration,
          status: output.status,
          hasResult: !!output.result
        }, 'Container completed');

        resolve(output);
      } catch (err) {
        logger.error({
          group: group.name,
          stdout: stdout.slice(-500),
          error: err
        }, 'Failed to parse container output');

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ group: group.name, error: err }, 'Container spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`
      });
    });
  });
}

export function writeTasksSnapshot(tasks: Array<{
  id: string;
  groupFolder: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  status: string;
  next_run: string | null;
}>): void {
  const ipcDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcDir, { recursive: true });
  const tasksFile = path.join(ipcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
}
