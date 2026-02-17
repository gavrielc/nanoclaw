import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import { SkillsConfig } from './types.js';

/**
 * Determine whether a skill should be synced based on the filter config.
 */
export function shouldIncludeSkill(
  skillName: string,
  filter?: SkillsConfig,
): boolean {
  if (!filter) return true;
  if (filter.mode === 'allow') {
    return filter.skills.includes(skillName);
  }
  return !filter.skills.includes(skillName);
}

/**
 * List all available skill directory names from the source.
 */
export function listAvailableSkills(skillsSrc: string): string[] {
  if (!fs.existsSync(skillsSrc)) return [];
  return fs.readdirSync(skillsSrc).filter((entry) => {
    return fs.statSync(path.join(skillsSrc, entry)).isDirectory();
  });
}

/**
 * Sync skills from source to destination, applying the optional filter.
 * Removes skills from destination that are no longer allowed.
 */
export function syncSkills(
  skillsSrc: string,
  skillsDst: string,
  filter?: SkillsConfig,
  groupName?: string,
): void {
  if (!fs.existsSync(skillsSrc)) return;

  const allSkills = listAvailableSkills(skillsSrc);
  const allowedSkills = allSkills.filter((s) => shouldIncludeSkill(s, filter));

  // Remove skills that exist in destination but are not allowed
  if (fs.existsSync(skillsDst)) {
    for (const existing of fs.readdirSync(skillsDst)) {
      const existingPath = path.join(skillsDst, existing);
      if (!fs.statSync(existingPath).isDirectory()) continue;
      if (!allowedSkills.includes(existing)) {
        fs.rmSync(existingPath, { recursive: true, force: true });
        logger.debug(
          { skill: existing, group: groupName },
          'Removed filtered-out skill',
        );
      }
    }
  }

  // Copy allowed skills
  for (const skillDir of allowedSkills) {
    const srcDir = path.join(skillsSrc, skillDir);
    const dstDir = path.join(skillsDst, skillDir);
    fs.mkdirSync(dstDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
    }
  }
}
