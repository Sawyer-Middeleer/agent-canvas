import { Router } from 'express';
import type { Request, Response } from 'express';
import { sanitizeId, resolveProjectPath } from '../services/claude-dir.js';
import { readProjects } from '../services/projects.js';
import { readSessions } from '../services/sessions.js';
import { readTranscript } from '../services/transcripts.js';
import { readSkills } from '../services/skills.js';
import { readConfig } from '../services/config.js';
import { readFileTree, readFileContent } from '../services/filetree.js';
import { archiveSession } from '../services/archive.js';

function writeError(res: Response, code: number, msg: string) {
  res.status(code).json({ error: msg });
}

/** Extract a single string param (Express 5 params can be string | string[]). */
function param(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

export const apiRouter = Router();

apiRouter.get('/api/projects', (_req: Request, res: Response) => {
  try {
    const projects = readProjects();
    res.json(projects);
  } catch (e) {
    writeError(res, 500, (e as Error).message);
  }
});

apiRouter.get('/api/projects/:id/sessions', (req: Request, res: Response) => {
  const id = param(req.params.id);
  if (!id || !sanitizeId(id)) {
    writeError(res, 400, 'invalid project id');
    return;
  }
  try {
    const sessions = readSessions(id);
    res.json(sessions);
  } catch (e) {
    writeError(res, 404, 'project not found: ' + (e as Error).message);
  }
});

apiRouter.get('/api/sessions/:projectID/:sessionID/transcript', async (req: Request, res: Response) => {
  const projectID = param(req.params.projectID);
  const sessionID = param(req.params.sessionID);
  if (!projectID || !sessionID || !sanitizeId(projectID) || !sanitizeId(sessionID)) {
    writeError(res, 400, 'invalid id');
    return;
  }

  try {
    const messages = await readTranscript(projectID, sessionID);
    const total = messages.length;
    res.setHeader('X-Total-Count', String(total));

    // Pagination: ?limit=N returns last N messages, ?offset=M skips M from the end
    let limit = total;
    let offset = 0;
    if (req.query.limit) {
      const n = parseInt(req.query.limit as string, 10);
      if (n > 0) limit = n;
    }
    if (req.query.offset) {
      const n = parseInt(req.query.offset as string, 10);
      if (n > 0) offset = n;
    }

    let end = total - offset;
    let start = end - limit;
    if (start < 0) start = 0;
    if (end < 0) end = 0;
    if (end > total) end = total;

    res.json(messages.slice(start, end));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('not exist') || msg.includes('not found')) {
      writeError(res, 404, 'transcript not found');
    } else {
      writeError(res, 500, msg);
    }
  }
});

apiRouter.post('/api/sessions/:projectID/:sessionID/archive', (req: Request, res: Response) => {
  const projectID = param(req.params.projectID);
  const sessionID = param(req.params.sessionID);
  if (!projectID || !sessionID || !sanitizeId(projectID) || !sanitizeId(sessionID)) {
    writeError(res, 400, 'invalid id');
    return;
  }
  try {
    archiveSession(sessionID);
    res.json({ status: 'archived' });
  } catch (e) {
    writeError(res, 500, (e as Error).message);
  }
});

apiRouter.get('/api/projects/:id/filetree', (req: Request, res: Response) => {
  const id = param(req.params.id);
  if (!id || !sanitizeId(id)) {
    writeError(res, 400, 'invalid project id');
    return;
  }
  try {
    const projectPath = resolveProjectPath(id);
    const tree = readFileTree(projectPath, 4, 500);
    res.json(tree);
  } catch (e) {
    writeError(res, 500, (e as Error).message);
  }
});

apiRouter.get('/api/projects/:id/file', (req: Request, res: Response) => {
  const id = param(req.params.id);
  if (!id || !sanitizeId(id)) {
    writeError(res, 400, 'invalid project id');
    return;
  }
  const relPath = req.query.path as string;
  if (!relPath) {
    writeError(res, 400, 'path query parameter required');
    return;
  }
  try {
    const projectPath = resolveProjectPath(id);
    const fc = readFileContent(projectPath, relPath);
    res.json(fc);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('outside project')) {
      writeError(res, 403, msg);
    } else {
      writeError(res, 404, msg);
    }
  }
});

apiRouter.get('/api/skills', (_req: Request, res: Response) => {
  try {
    const skills = readSkills();
    res.json(skills);
  } catch (e) {
    writeError(res, 500, (e as Error).message);
  }
});

apiRouter.get('/api/config', (_req: Request, res: Response) => {
  try {
    const cfg = readConfig();
    res.json(cfg);
  } catch (e) {
    writeError(res, 500, (e as Error).message);
  }
});
