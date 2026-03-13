import path from 'path';
import fs from 'fs';
import { claudeDir, resolveProjectPath, findWorktreeProjectIDs, readJSONLLines } from './claude-dir.js';
import type { TranscriptMessage, SessionsIndex } from '../types.js';

function readSessionsIndex(projectDir: string): SessionsIndex | null {
  try {
    const data = fs.readFileSync(path.join(projectDir, 'sessions-index.json'), 'utf8');
    return JSON.parse(data) as SessionsIndex;
  } catch {
    return null;
  }
}

/**
 * Locates the JSONL file for a session, searching the main project dir
 * and any worktree project dirs.
 */
export function findTranscriptPath(projectID: string, sessionID: string): string | null {
  const projectDir = path.join(claudeDir(), 'projects', projectID);

  // Try direct path
  const direct = path.join(projectDir, `${sessionID}.jsonl`);
  if (fs.existsSync(direct)) return direct;

  // Try sessions-index in main dir
  const idx = readSessionsIndex(projectDir);
  if (idx) {
    for (const s of idx.entries) {
      if (s.sessionId === sessionID && s.fullPath) {
        const p = path.normalize(s.fullPath.replace(/\\/g, '/'));
        if (fs.existsSync(p)) return p;
      }
    }
  }

  // Search worktree project dirs
  const parentPath = resolveProjectPath(projectID);
  for (const wtID of findWorktreeProjectIDs(parentPath)) {
    const wtDir = path.join(claudeDir(), 'projects', wtID);
    const p = path.join(wtDir, `${sessionID}.jsonl`);
    if (fs.existsSync(p)) return p;

    const wtIdx = readSessionsIndex(wtDir);
    if (wtIdx) {
      for (const s of wtIdx.entries) {
        if (s.sessionId === sessionID && s.fullPath) {
          const fp = path.normalize(s.fullPath.replace(/\\/g, '/'));
          if (fs.existsSync(fp)) return fp;
        }
      }
    }
  }

  return null;
}

/**
 * Reads and parses a session JSONL file, returning user/assistant/result messages.
 */
export async function readTranscript(projectID: string, sessionID: string): Promise<TranscriptMessage[]> {
  const jsonlPath = findTranscriptPath(projectID, sessionID);
  if (!jsonlPath) throw new Error(`transcript not found for session ${sessionID}`);

  const messages: TranscriptMessage[] = [];
  await readJSONLLines(jsonlPath, (obj) => {
    const type = obj.type as string;
    if (type === 'user' || type === 'assistant' || type === 'result') {
      messages.push(obj as unknown as TranscriptMessage);
    }
  });
  return messages;
}
