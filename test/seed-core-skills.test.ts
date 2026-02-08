import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock GROUPS_DIR to use a temp directory
let tmpDir: string;

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>(
    '../src/config.js',
  );
  return {
    ...actual,
    get GROUPS_DIR() {
      return tmpDir;
    },
  };
});

// Mock logger to suppress output during tests
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { seedCoreSkills } = await import('../src/container-runner.js');

const CORE_SKILLS_DIR = path.join(process.cwd(), 'container', 'skills');

describe('seedCoreSkills', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates agent-browser/SKILL.md in a fresh group directory', () => {
    seedCoreSkills('test-group');

    const skillPath = path.join(
      tmpDir,
      'test-group',
      '.claude',
      'skills',
      'agent-browser',
      'SKILL.md',
    );
    expect(fs.existsSync(skillPath)).toBe(true);

    const src = fs.readFileSync(
      path.join(CORE_SKILLS_DIR, 'agent-browser', 'SKILL.md'),
      'utf8',
    );
    const dest = fs.readFileSync(skillPath, 'utf8');
    expect(dest).toBe(src);
  });

  it('creates add-skill/SKILL.md in a fresh group directory', () => {
    seedCoreSkills('test-group');

    const skillPath = path.join(
      tmpDir,
      'test-group',
      '.claude',
      'skills',
      'add-skill',
      'SKILL.md',
    );
    expect(fs.existsSync(skillPath)).toBe(true);

    const src = fs.readFileSync(
      path.join(CORE_SKILLS_DIR, 'add-skill', 'SKILL.md'),
      'utf8',
    );
    const dest = fs.readFileSync(skillPath, 'utf8');
    expect(dest).toBe(src);
  });

  it('does not overwrite existing group skills', () => {
    // First seed
    seedCoreSkills('test-group');

    const skillPath = path.join(
      tmpDir,
      'test-group',
      '.claude',
      'skills',
      'agent-browser',
      'SKILL.md',
    );

    // Simulate user customization
    fs.writeFileSync(skillPath, 'CUSTOM CONTENT');

    // Re-seed
    seedCoreSkills('test-group');

    // Should still be the custom content
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toBe('CUSTOM CONTENT');
  });

  it('seeds all expected core skills', () => {
    seedCoreSkills('test-group');

    const skillsDir = path.join(
      tmpDir,
      'test-group',
      '.claude',
      'skills',
    );
    const seeded = fs.readdirSync(skillsDir).sort();
    expect(seeded).toContain('agent-browser');
    expect(seeded).toContain('add-skill');
  });
});
