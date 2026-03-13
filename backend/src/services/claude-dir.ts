import { homedir } from 'os';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

/** Returns the path to ~/.claude */
export function claudeDir(): string {
  return path.join(homedir(), '.claude');
}

/**
 * Best-effort decode of the encoded project directory name back to a filesystem path.
 * Every "-" is a path separator; "C--" at the start becomes "C:\".
 */
export function decodeProjectPath(encoded: string): string {
  let s = encoded;
  if (s.length >= 3 && s[1] === '-' && s[2] === '-') {
    s = s[0] + ':\\' + s.slice(3);
  }
  return s.replaceAll('-', path.sep);
}

/**
 * Get the real filesystem path for a project by peeking at the cwd field
 * in JSONL transcript system messages. Falls back to decodeProjectPath.
 */
export function resolveProjectPath(projectID: string): string {
  const projectDir = path.join(claudeDir(), 'projects', projectID);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return decodeProjectPath(projectID);
  }
  for (const e of entries) {
    if (!e.name.endsWith('.jsonl')) continue;
    const cwd = peekCWD(path.join(projectDir, e.name));
    if (cwd) return cwd;
  }
  return decodeProjectPath(projectID);
}

/**
 * Reads the first few lines of a JSONL file to extract cwd from the system init message.
 */
export function peekCWD(jsonlPath: string): string {
  let fd: number;
  try {
    fd = fs.openSync(jsonlPath, 'r');
  } catch {
    return '';
  }
  try {
    // Read first 64KB — enough to cover the system init line
    const buf = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString('utf8', 0, bytesRead);
    const lines = text.split('\n');
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'system' && obj.cwd) return obj.cwd;
      } catch { /* skip malformed */ }
    }
  } finally {
    fs.closeSync(fd);
  }
  return '';
}

/**
 * Checks if a resolved project path is a .claude/worktrees/ subdirectory.
 * Returns [parentPath, true] if so.
 */
export function isWorktreeProject(resolvedPath: string): { parentPath: string; isWorktree: boolean } {
  const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
  const idx = resolvedPath.indexOf(marker);
  if (idx < 0) return { parentPath: '', isWorktree: false };
  return { parentPath: resolvedPath.slice(0, idx), isWorktree: true };
}

/**
 * Returns project directory names (IDs) that are worktrees belonging to the given parent path.
 */
export function findWorktreeProjectIDs(parentPath: string): string[] {
  const projectsDir = path.join(claudeDir(), 'projects');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  const cleanParent = path.resolve(parentPath).toLowerCase();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const resolved = resolveProjectPath(e.name);
    const wt = isWorktreeProject(resolved);
    if (wt.isWorktree && path.resolve(wt.parentPath).toLowerCase() === cleanParent) {
      ids.push(e.name);
    }
  }
  return ids;
}

/** Validates an ID contains only alphanumeric, dash, underscore. */
export function sanitizeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Reads a JSONL file line-by-line via streaming. Calls handler for each parsed line.
 * Handles very large lines (up to 10MB+).
 */
export async function readJSONLLines(
  filePath: string,
  handler: (obj: Record<string, unknown>) => void | 'stop',
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (handler(obj) === 'stop') break;
    } catch { /* skip malformed */ }
  }
}
