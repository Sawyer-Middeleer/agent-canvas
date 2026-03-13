import path from 'path';
import fs from 'fs';
import {
  claudeDir, resolveProjectPath, findWorktreeProjectIDs, peekCWD,
} from './claude-dir.js';
import { loadArchived } from './archive.js';
import type { Session, SessionsIndex, CronJob } from '../types.js';

// Cache for filesTouched to avoid re-scanning JSONL on every poll
const fileTouchCache = new Map<string, { modTime: number; filesTouched: string[] }>();

function readSessionsIndex(projectDir: string): SessionsIndex | null {
  try {
    const data = fs.readFileSync(path.join(projectDir, 'sessions-index.json'), 'utf8');
    return JSON.parse(data) as SessionsIndex;
  } catch {
    return null;
  }
}

function transcriptExists(projectDir: string, sessionID: string, fullPath: string): boolean {
  if (fs.existsSync(path.join(projectDir, `${sessionID}.jsonl`))) return true;
  if (fullPath) {
    const normalized = path.normalize(fullPath.replace(/\\/g, '/'));
    if (fs.existsSync(normalized)) return true;
  }
  return false;
}

/** Reads sessions from a single project directory, merging index + orphan JSONL files. */
function readSessionsFromDir(projectDir: string): Session[] {
  const sessions: Session[] = [];
  const indexed = new Set<string>();

  const idx = readSessionsIndex(projectDir);
  if (idx) {
    for (const s of idx.entries) {
      s.hasTranscript = transcriptExists(projectDir, s.sessionId, s.fullPath);
      indexed.add(s.sessionId);
    }
    sessions.push(...idx.entries);
  }

  // Discover orphan JSONL files not in the index
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return sessions;
  }

  for (const e of entries) {
    if (!e.name.endsWith('.jsonl')) continue;
    const sid = e.name.slice(0, -6); // strip .jsonl
    if (indexed.has(sid)) continue;

    let mod = '';
    try {
      const stat = fs.statSync(path.join(projectDir, e.name));
      mod = stat.mtime.toISOString();
    } catch { /* skip */ }

    const s: Session = {
      sessionId: sid,
      fullPath: path.join(projectDir, e.name),
      firstPrompt: '',
      summary: '',
      messageCount: 0,
      created: mod,
      modified: mod,
      gitBranch: '',
      projectPath: '',
      isSidechain: false,
      hasTranscript: true,
      isActive: false,
    };
    fillSessionMetadata(s);
    sessions.push(s);
  }
  return sessions;
}

/**
 * Returns sessions for a given project ID.
 * Merges sessions from the main project dir and any worktree project dirs.
 */
export function readSessions(projectID: string): Session[] {
  const projectDir = path.join(claudeDir(), 'projects', projectID);
  const sessions = readSessionsFromDir(projectDir);
  const seen = new Set(sessions.map(s => s.sessionId));

  // Also collect sessions from worktree project dirs
  const parentPath = resolveProjectPath(projectID);
  for (const wtID of findWorktreeProjectIDs(parentPath)) {
    const wtDir = path.join(claudeDir(), 'projects', wtID);
    for (const s of readSessionsFromDir(wtDir)) {
      if (!seen.has(s.sessionId)) {
        seen.add(s.sessionId);
        sessions.push(s);
      }
    }
  }

  // Backfill metadata for sessions with transcripts but empty summaries
  for (const s of sessions) {
    if (s.hasTranscript && !s.summary) {
      fillSessionMetadata(s);
    }
  }

  // Enrich sessions with active status and activity data
  for (const s of sessions) {
    if (s.hasTranscript) {
      let dir = projectDir;
      if (s.fullPath) {
        dir = path.dirname(path.normalize(s.fullPath.replace(/\\/g, '/')));
      }
      enrichActiveSession(s, dir);
    }
  }

  // Filter out archived sessions
  const archived = loadArchived();
  if (archived.size > 0) {
    return sessions.filter(s => !archived.has(s.sessionId));
  }

  return sessions;
}

/** Checks if a session is currently active using file-history and JSONL mod time. */
function enrichActiveSession(s: Session, projectDir: string): void {
  // Primary signal: file-history directory recency
  const fhDir = path.join(claudeDir(), 'file-history', s.sessionId);
  try {
    const entries = fs.readdirSync(fhDir, { withFileTypes: true });
    let newest = 0;
    for (const e of entries) {
      try {
        const stat = fs.statSync(path.join(fhDir, e.name));
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      } catch { /* skip */ }
    }
    if (newest > 0 && Date.now() - newest < 5 * 60 * 1000) {
      s.isActive = true;
    }
  } catch { /* no file-history dir */ }

  // Secondary signal: JSONL mod time
  if (!s.isActive) {
    let jsonlPath = path.join(projectDir, `${s.sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath) && s.fullPath) {
      jsonlPath = path.normalize(s.fullPath.replace(/\\/g, '/'));
    }
    try {
      const stat = fs.statSync(jsonlPath);
      if (Date.now() - stat.mtimeMs < 2 * 60 * 1000) {
        s.isActive = true;
      }
    } catch { /* skip */ }
  }

  // Tail-scan the JSONL for filesTouched
  let jsonlPath = path.join(projectDir, `${s.sessionId}.jsonl`);
  if (!fs.existsSync(jsonlPath) && s.fullPath) {
    jsonlPath = path.normalize(s.fullPath.replace(/\\/g, '/'));
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(jsonlPath);
  } catch {
    return;
  }

  if (s.isActive) {
    // Active sessions always get fresh data
    tailSessionActivity(s, jsonlPath, stat.size);
    s.cronJobs = extractCronJobs(jsonlPath);
    fileTouchCache.set(s.sessionId, { modTime: stat.mtimeMs, filesTouched: s.filesTouched ?? [] });
  } else {
    // Inactive: use cache if modtime hasn't changed
    const cached = fileTouchCache.get(s.sessionId);
    if (cached && cached.modTime === stat.mtimeMs) {
      s.filesTouched = cached.filesTouched;
    } else {
      tailSessionActivity(s, jsonlPath, stat.size);
      fileTouchCache.set(s.sessionId, { modTime: stat.mtimeMs, filesTouched: s.filesTouched ?? [] });
    }
  }
}

/** Reads the last 1MB of a JSONL file to extract tool use activity. */
function tailSessionActivity(s: Session, filePath: string, size: number): void {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return;
  }

  try {
    const chunkSize = Math.min(1024 * 1024, size);
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, size - chunkSize);

    const lines = buf.toString('utf8').split('\n');
    const projectRoot = s.projectPath || peekCWD(filePath);
    const filesTouched = new Map<string, boolean>();
    let foundLast = false;

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;

      let peek: {
        type?: string;
        message?: { role?: string; content?: unknown };
      };
      try {
        peek = JSON.parse(line);
      } catch {
        continue;
      }

      if (peek.type !== 'assistant' || !peek.message) continue;
      const content = peek.message.content;
      if (!Array.isArray(content)) continue;

      for (let j = content.length - 1; j >= 0; j--) {
        const b = content[j] as { type?: string; name?: string; input?: Record<string, unknown> };
        if (b.type !== 'tool_use') continue;

        const fp = b.input?.file_path as string | undefined;
        if (fp) {
          // Only include files that still exist
          try {
            fs.statSync(fp);
            let display = fp;
            if (projectRoot) {
              const rel = path.relative(projectRoot, fp);
              if (!rel.startsWith('..')) display = rel.replace(/\\/g, '/');
            }
            filesTouched.set(display, true);
          } catch { /* file doesn't exist */ }

          if (!foundLast) {
            s.lastToolUse = b.name;
            s.lastToolTarget = path.basename(fp);
            foundLast = true;
          }
        } else if (!foundLast) {
          s.lastToolUse = b.name;
          const cmd = b.input?.command as string | undefined;
          const pat = b.input?.pattern as string | undefined;
          if (cmd) {
            s.lastToolTarget = cmd.length > 60 ? cmd.slice(0, 60) : cmd;
          } else if (pat) {
            s.lastToolTarget = pat;
          }
          foundLast = true;
        }
      }

      if (filesTouched.size > 20) break;
    }

    s.filesTouched = [...filesTouched.keys()].sort();
  } finally {
    fs.closeSync(fd);
  }
}

/** Scans a session JSONL for CronCreate/CronDelete tool_use blocks. */
function extractCronJobs(jsonlPath: string): CronJob[] {
  let data: string;
  try {
    data = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return [];
  }

  const jobs = new Map<string, CronJob>();
  const pendingCreates = new Map<string, CronJob>(); // tool_use id -> partial job

  for (const line of data.split('\n')) {
    if (!line.trim()) continue;

    let peek: {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    try {
      peek = JSON.parse(line);
    } catch {
      continue;
    }

    if (!peek.message) continue;
    const content = peek.message.content;
    if (!Array.isArray(content)) continue;

    if (peek.type === 'assistant') {
      for (const b of content) {
        const block = b as { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
        if (block.type !== 'tool_use') continue;

        if (block.name === 'CronCreate') {
          const job: CronJob = {
            id: '',
            cron: (block.input?.cron as string) ?? '',
            prompt: (block.input?.prompt as string) ?? '',
            recurring: (block.input?.recurring as boolean) ?? false,
          };
          if (block.id) pendingCreates.set(block.id, job);
        } else if (block.name === 'CronDelete') {
          const id = block.input?.id as string;
          if (id) jobs.delete(id);
        }
      }
    }

    // Check for tool results that resolve pending CronCreate IDs
    if (peek.type === 'result' || (peek.type === 'user' && peek.message?.role === 'user')) {
      for (const cb of content) {
        const block = cb as { type?: string; tool_use_id?: string; content?: string };
        if (block.type === 'tool_result' && block.tool_use_id) {
          const job = pendingCreates.get(block.tool_use_id);
          if (job) {
            let jobID = block.tool_use_id;
            const text = block.content ?? '';
            const idx = text.indexOf('job ');
            if (idx >= 0) {
              const rest = text.slice(idx + 4);
              const sp = rest.search(/[ (.\n]/);
              jobID = sp > 0 ? rest.slice(0, sp) : rest;
            }
            job.id = jobID;
            jobs.set(job.id, job);
            pendingCreates.delete(block.tool_use_id);
          }
        }
      }
    }
  }

  return jobs.size === 0 ? [] : [...jobs.values()];
}

/** Reads the JSONL to extract metadata for sessions missing info. */
function fillSessionMetadata(s: Session): void {
  if (!s.fullPath) return;
  const normalized = path.normalize(s.fullPath.replace(/\\/g, '/'));

  let data: string;
  try {
    data = fs.readFileSync(normalized, 'utf8');
  } catch {
    return;
  }

  let msgCount = 0;
  let firstUserText = '';

  for (const line of data.split('\n')) {
    if (!line.trim()) continue;

    let peek: {
      type?: string;
      cwd?: string;
      gitBranch?: string;
      message?: { role?: string; content?: unknown };
    };
    try {
      peek = JSON.parse(line);
    } catch {
      continue;
    }

    if (peek.type === 'system') {
      if (!s.gitBranch && peek.gitBranch) s.gitBranch = peek.gitBranch;
      if (!s.projectPath && peek.cwd) s.projectPath = peek.cwd;
      continue;
    }

    if (peek.type === 'user' || peek.type === 'assistant') {
      msgCount++;
    }

    if (peek.type === 'user' && !firstUserText && peek.message?.role === 'user') {
      const content = peek.message.content;
      if (typeof content === 'string') {
        firstUserText = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type?: string; text?: string };
          if (b.type === 'text' && b.text) {
            firstUserText = b.text;
            break;
          }
        }
      }
    }
  }

  s.messageCount = msgCount;
  if (!s.firstPrompt && firstUserText) {
    s.firstPrompt = firstUserText.length > 200 ? firstUserText.slice(0, 200) : firstUserText;
  }
  if (!s.summary && firstUserText) {
    const line = firstUserText.split('\n')[0];
    s.summary = line.length > 100 ? line.slice(0, 100) : line;
  }
}
