import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import type { SkillInfo } from '../types.js';

const SKILLS_DIR = path.resolve(process.cwd(), 'container', 'skills');

function parseSkillMd(content: string): { description: string; allowedTools: string[] } {
  let description = '';
  const allowedTools: string[] = [];
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterDone = false;

  for (const line of lines) {
    if (line.trim() === '---' && !frontmatterDone) {
      if (inFrontmatter) {
        frontmatterDone = true;
        continue;
      }
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && !frontmatterDone) {
      const match = line.match(/^(\w[\w-]*):\s*(.+)/);
      if (match) {
        const [, key, value] = match;
        if (key === 'description') description = value.trim();
        if (key === 'allowed-tools' || key === 'allowed_tools') {
          allowedTools.push(...value.split(',').map((t) => t.trim()).filter(Boolean));
        }
      }
    }
    if (frontmatterDone && !description && line.startsWith('#')) {
      // Use first heading as description fallback
      description = line.replace(/^#+\s*/, '').trim();
    }
  }

  return { description, allowedTools };
}

function getSkills(): SkillInfo[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills: SkillInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    const content = fs.readFileSync(skillMd, 'utf-8');
    const { description, allowedTools } = parseSkillMd(content);
    const disabled = fs.existsSync(path.join(skillDir, '.disabled'));

    skills.push({
      name: entry.name,
      description,
      allowedTools,
      enabled: !disabled,
      content,
      path: skillDir,
    });
  }

  return skills;
}

export function registerSkillRoutes(app: FastifyInstance): void {
  app.get('/api/skills', async () => {
    return getSkills();
  });

  app.get<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => {
    const skills = getSkills();
    const skill = skills.find((s) => s.name === req.params.name);
    if (!skill) return reply.status(404).send({ error: 'Skill not found' });
    return skill;
  });

  app.post<{ Params: { name: string } }>('/api/skills/:name/toggle', async (req, reply) => {
    const skillDir = path.join(SKILLS_DIR, req.params.name);
    if (!fs.existsSync(skillDir)) return reply.status(404).send({ error: 'Skill not found' });

    const disabledPath = path.join(skillDir, '.disabled');
    if (fs.existsSync(disabledPath)) {
      fs.unlinkSync(disabledPath);
      return { enabled: true };
    } else {
      fs.writeFileSync(disabledPath, '');
      return { enabled: false };
    }
  });

  // Create a new skill
  app.post<{ Body: { name: string; content: string } }>('/api/skills', async (req, reply) => {
    const { name, content } = req.body || {};
    if (!name || !content) return reply.status(400).send({ error: 'name and content required' });

    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeName) return reply.status(400).send({ error: 'Invalid skill name' });

    const skillDir = path.join(SKILLS_DIR, safeName);
    if (fs.existsSync(skillDir)) return reply.status(409).send({ error: 'Skill already exists' });

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    return { ok: true, name: safeName };
  });

  // Update skill content
  app.put<{ Params: { name: string }; Body: { content: string } }>(
    '/api/skills/:name',
    async (req, reply) => {
      const skillDir = path.join(SKILLS_DIR, req.params.name);
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) return reply.status(404).send({ error: 'Skill not found' });

      const { content } = req.body || {};
      if (!content) return reply.status(400).send({ error: 'content required' });

      fs.writeFileSync(skillMd, content);
      return { ok: true };
    },
  );

  // Delete a skill
  app.delete<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => {
    const skillDir = path.join(SKILLS_DIR, req.params.name);
    if (!fs.existsSync(skillDir)) return reply.status(404).send({ error: 'Skill not found' });

    fs.rmSync(skillDir, { recursive: true, force: true });
    return { ok: true };
  });
}
