import path from 'path';
import fs from 'fs';
import { claudeDir, resolveProjectPath, isWorktreeProject } from './claude-dir.js';
import { readSessions } from './sessions.js';
import type { Project } from '../types.js';

export function readProjects(): Project[] {
  const projectsDir = path.join(claudeDir(), 'projects');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // First pass: resolve all paths and identify worktrees
  const allProjects: { name: string; resolved: string; modTime: Date }[] = [];
  const worktreeIDs = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const resolved = resolveProjectPath(name);
    let modTime = new Date(0);
    try {
      const stat = fs.statSync(path.join(projectsDir, name));
      modTime = stat.mtime;
    } catch { /* skip */ }
    allProjects.push({ name, resolved, modTime });

    if (isWorktreeProject(resolved).isWorktree) {
      worktreeIDs.add(name);
    }
  }

  // Second pass: build project list, skipping worktrees
  const projects: Project[] = [];
  for (const p of allProjects) {
    if (worktreeIDs.has(p.name)) continue;

    let sessCount = 0;
    try {
      const ss = readSessions(p.name);
      sessCount = ss.length;
    } catch { /* skip */ }

    projects.push({
      id: p.name,
      path: p.resolved,
      encodedName: p.name,
      sessionCount: sessCount,
      lastModified: p.modTime.toISOString(),
    });
  }
  return projects;
}
