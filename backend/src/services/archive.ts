import path from 'path';
import fs from 'fs';
import { claudeDir } from './claude-dir.js';

function archiveFilePath(): string {
  return path.join(claudeDir(), 'agent-canvas-archived.json');
}

export function loadArchived(): Set<string> {
  try {
    const data = fs.readFileSync(archiveFilePath(), 'utf8');
    const ids: string[] = JSON.parse(data);
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function saveArchived(set: Set<string>): void {
  const ids = [...set];
  fs.writeFileSync(archiveFilePath(), JSON.stringify(ids), 'utf8');
}

export function archiveSession(sessionID: string): void {
  const set = loadArchived();
  set.add(sessionID);
  saveArchived(set);
}

export function isArchived(sessionID: string): boolean {
  return loadArchived().has(sessionID);
}
