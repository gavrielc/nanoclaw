export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
  closedDuringQuery?: boolean;
  resumeAt?: string;
}

export interface AdapterInput {
  prompt: string;
  sessionId?: string;
  resumeAt?: string;
  cwd: string;
  env: Record<string, string | undefined>;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  globalClaudeMd?: string;
  extraDirs: string[];
  mcpServerPath?: string;
}

export interface AgentAdapter {
  run(input: AdapterInput): AsyncGenerator<ContainerOutput>;
}
