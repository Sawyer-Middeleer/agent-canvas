import crypto from 'crypto';
import { query } from '@anthropic-ai/claude-code';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { resolveProjectPath } from '../services/claude-dir.js';
import { readSessions } from '../services/sessions.js';

interface PromptMessage {
  type: 'prompt';
  prompt: string;
  action?: 'create' | 'resume';
  skipPermissions?: boolean;
}

interface PermissionResponse {
  type: 'permission_response';
  toolUseID: string;
  approved: boolean;
  reason?: string;
  updatedInput?: Record<string, unknown>;
}

type ClientMessage = PromptMessage | PermissionResponse;

interface PendingPermission {
  resolve: (result: { behavior: 'allow'; updatedInput: Record<string, unknown> } |
                     { behavior: 'deny'; message: string }) => void;
  originalInput: Record<string, unknown>;
}

function wsSend(ws: WebSocket, data: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function handleSessionWS(ws: WebSocket, req: IncomingMessage): void {
  // Extract projectID and sessionID from URL: /ws/sessions/:projectID/:sessionID
  const parts = (req.url ?? '').split('/').filter(Boolean);
  // parts: ['ws', 'sessions', projectID, sessionID]
  const projectID = parts[2] ?? '';
  const sessionID = parts[3] ?? '';

  if (!projectID || !sessionID) {
    wsSend(ws, { error: 'projectID and sessionID required' });
    ws.close();
    return;
  }

  console.log(`WS: session ${sessionID} in project ${projectID}`);
  wsSend(ws, { type: 'status', status: 'starting' });

  let resolvedPath = '';
  let abortController: AbortController | null = null;
  let queryInstance: ReturnType<typeof query> | null = null;
  const pendingPermissions = new Map<string, PendingPermission>();

  // Handle permission responses from frontend
  function handlePermissionResponse(msg: PermissionResponse): void {
    const pending = pendingPermissions.get(msg.toolUseID);
    if (!pending) return;
    pendingPermissions.delete(msg.toolUseID);

    if (msg.approved) {
      pending.resolve({ behavior: 'allow', updatedInput: msg.updatedInput ?? pending.originalInput });
    } else {
      pending.resolve({ behavior: 'deny', message: msg.reason ?? 'User denied' });
    }
  }

  async function runQuery(prompt: string, action: string, skipPermissions: boolean): Promise<void> {
    // Abort any previous query
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    // Resolve project path on first prompt
    if (!resolvedPath) {
      if (action === 'create') {
        resolvedPath = resolveProjectPath(projectID);
      } else {
        // Resume: try to find project path from sessions index
        try {
          const sessions = readSessions(projectID);
          const s = sessions.find(s => s.sessionId === sessionID);
          if (s?.projectPath) resolvedPath = s.projectPath;
        } catch { /* ignore */ }
        if (!resolvedPath) resolvedPath = resolveProjectPath(projectID);
      }
    }

    // Build query options
    const options: Record<string, unknown> = {
      cwd: resolvedPath,
      abortController,
      includePartialMessages: true,
      verbose: true,
    };

    if (action === 'create') {
      options.sessionId = sessionID;
    } else {
      options.resume = sessionID;
    }

    if (skipPermissions) {
      options.permissionMode = 'bypassPermissions';
    } else {
      options.permissionMode = 'default';
      options.canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        opts: { signal: AbortSignal; suggestions?: unknown[] },
      ) => {
        const toolUseID = crypto.randomUUID();

        // Send permission request to frontend
        wsSend(ws, {
          type: 'permission_request',
          toolUseID,
          toolName,
          input,
          suggestions: opts.suggestions,
        });

        // Wait for response from frontend
        return new Promise<
          { behavior: 'allow'; updatedInput: Record<string, unknown> } |
          { behavior: 'deny'; message: string }
        >((resolve, reject) => {
          pendingPermissions.set(toolUseID, { resolve, originalInput: input });
          opts.signal.addEventListener('abort', () => {
            pendingPermissions.delete(toolUseID);
            reject(new Error('Aborted'));
          });
        });
      };
    }

    console.log(`WS: ${action === 'create' ? 'creating' : 'resuming'} session ${sessionID} in ${resolvedPath} (skipPerms=${skipPermissions})`);

    let sentDone = false;
    try {
      wsSend(ws, { type: 'status', status: 'running' });

      queryInstance = query({ prompt, options });
      for await (const message of queryInstance) {
        if (ws.readyState !== ws.OPEN) break;

        const msg = message as Record<string, unknown>;
        const msgType = msg.type as string;

        if (msgType === 'system') {
          // Session initialized
        } else if (msgType === 'stream_event') {
          const event = msg.event as Record<string, unknown>;
          if (event) wsSend(ws, event);
        } else if (msgType === 'assistant') {
          wsSend(ws, { ...msg, source: 'stream' });
        } else if (msgType === 'result') {
          wsSend(ws, msg);
          wsSend(ws, { type: 'status', status: 'done' });
          sentDone = true;
        } else if (msgType === 'user') {
          wsSend(ws, msg);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error(`WS error: ${(e as Error).message}`);
        wsSend(ws, { error: (e as Error).message });
      }
    } finally {
      queryInstance = null;
      if (!sentDone && ws.readyState === ws.OPEN) {
        wsSend(ws, { type: 'status', status: 'done' });
      }
    }
  }

  ws.on('message', (data: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === 'permission_response') {
      handlePermissionResponse(msg as PermissionResponse);
      return;
    }

    if (msg.type === 'prompt') {
      const pm = msg as PromptMessage;
      if (!pm.prompt) return;
      const action = pm.action ?? 'resume';
      const skipPerms = pm.skipPermissions ?? false;
      runQuery(pm.prompt, action, skipPerms).catch(e => {
        console.error(`WS runQuery error: ${(e as Error).message}`);
      });
    }
  });

  ws.on('close', () => {
    console.log(`WS: closed session ${sessionID}`);
    // Abort running query
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    // Reject pending permissions
    for (const [, pending] of pendingPermissions) {
      pending.resolve({ behavior: 'deny', message: 'WebSocket closed' });
    }
    pendingPermissions.clear();
  });
}
