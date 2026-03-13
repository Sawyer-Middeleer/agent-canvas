import path from 'path';
import fs from 'fs';
import { claudeDir } from './claude-dir.js';
import type { Skill } from '../types.js';

export function readSkills(): Skill[] {
  const skillsDir = path.join(claudeDir(), 'skills');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    const skill = parseSkillFile(skillPath);
    if (skill) skills.push(skill);
  }
  return skills;
}

function parseSkillFile(filePath: string): Skill | null {
  let data: string;
  try {
    data = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const skill: Skill = {
    name: '',
    description: '',
    trigger: '',
    matchTools: [],
    filePath,
    body: '',
  };

  if (data.startsWith('---\n')) {
    const endIdx = data.indexOf('\n---', 4);
    if (endIdx >= 0) {
      const frontmatter = data.slice(4, endIdx);
      skill.body = data.slice(endIdx + 4).trim();

      let inMatchTools = false;
      for (const line of frontmatter.split('\n')) {
        const trimmed = line.trim();
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0 && !trimmed.startsWith('- ')) {
          inMatchTools = false;
          const key = trimmed.slice(0, colonIdx).trim();
          const val = trimmed.slice(colonIdx + 1).trim();
          switch (key) {
            case 'name': skill.name = val; break;
            case 'description': skill.description = val; break;
            case 'trigger': skill.trigger = val; break;
            case 'match_tools': inMatchTools = true; break;
          }
        } else if (trimmed.startsWith('- ') && inMatchTools) {
          skill.matchTools.push(trimmed.slice(2));
        }
      }
    }
  }

  if (!skill.name) {
    skill.name = path.basename(path.dirname(filePath));
  }
  return skill;
}
