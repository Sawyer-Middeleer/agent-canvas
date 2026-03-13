# Agent Canvas

Miro-style infinite canvas for visualizing Claude Code local state — projects, sessions, transcripts, skills, hooks, and config. Supports interactive Claude Code sessions with per-tool permission approval.

## Architecture

- **Backend** (`backend/`): Node.js + TypeScript + Express 5 on `:3333`. Uses `@anthropic-ai/claude-code` Agent SDK for interactive sessions. Reads `~/.claude/` filesystem directly. No database.
- **Frontend** (`frontend/`): React + TypeScript + Vite on `:5173` (dev). Uses `react-zoom-pan-pinch` for the infinite canvas.

### Backend Structure

```
backend/
├── src/
│   ├── index.ts              # Express + WS server, CORS, static serving
│   ├── types.ts              # All shared interfaces (mirrors frontend/src/types.ts)
│   ├── routes/
│   │   ├── api.ts            # REST endpoints (Express Router)
│   │   └── ws.ts             # WebSocket handler (Agent SDK query + permissions)
│   └── services/
│       ├── claude-dir.ts     # Core utils: claudeDir, resolveProjectPath, peekCWD, readJSONLLines
│       ├── sessions.ts       # readSessions, enrichActiveSession, tailSessionActivity, extractCronJobs
│       ├── projects.ts       # readProjects (lists projects, skips worktrees, counts sessions)
│       ├── transcripts.ts    # findTranscriptPath, readTranscript
│       ├── skills.ts         # readSkills (parses SKILL.md YAML frontmatter)
│       ├── config.ts         # readConfig (hooks, plugins, permissions, settings)
│       ├── filetree.ts       # readFileTree, readFileContent
│       └── archive.ts        # archiveSession
├── package.json              # express, ws, @anthropic-ai/claude-code, tsx
└── tsconfig.json             # ES2022, Node16, strict, ESM
```

### Frontend Structure

```
frontend/
├── src/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Top-level layout, project selector, skipPermissions toggle
│   ├── App.css               # All styles (single file)
│   ├── Canvas.tsx            # Infinite canvas with zoom/pan
│   ├── types.ts              # Shared interfaces (mirrors backend/src/types.ts)
│   ├── hooks/
│   │   ├── useAPI.ts         # useProjects, useSessions, useSkills, useConfig, fetchTranscript
│   │   └── useSession.ts     # useSessionWS (WebSocket hook for live sessions + permissions)
│   └── components/
│       ├── SessionCard.tsx       # Session card on canvas
│       ├── DetailPane.tsx        # Session detail view with transcript + resume input
│       ├── ChatPane.tsx          # New session chat view
│       ├── MessageRenderer.tsx   # Renders transcript messages (text, thinking, tool_use blocks)
│       ├── PermissionPrompt.tsx  # Allow/Deny UI for tool permission requests
│       ├── SkillCard.tsx         # Skill card on canvas
│       ├── ConfigPanel.tsx       # Config viewer panel
│       ├── FileTree.tsx          # File tree component
│       ├── FileTreeSidebar.tsx   # File tree sidebar panel
│       ├── FileCard.tsx          # File viewer card
│       ├── FileViewerPane.tsx    # File content viewer
│       └── ProjectContextBar.tsx # Project info bar
└── vite.config.ts            # Proxy /api and /ws to :3333
```

## Key Patterns

### Agent SDK Integration (`backend/src/routes/ws.ts`)

The WebSocket handler uses the SDK's `query()` function which returns an async iterable of messages. Key patterns:

- **Session create vs resume**: `options.sessionId` for new sessions, `options.resume` for existing
- **Permission modes**: `bypassPermissions` (skip all) or `default` with `canUseTool` callback
- **`canUseTool` callback**: Returns a Promise that resolves when the frontend sends Allow/Deny. Must return `{ behavior: 'allow', updatedInput }` (updatedInput is **required**, not optional) or `{ behavior: 'deny', message }`
- **Message types from SDK**: `system`, `stream_event` (wraps raw API events), `assistant`, `result`, `user`
- **Abort handling**: `AbortController` passed to query options; abort signal listener on pending permissions to reject on close

### WebSocket Protocol

Client → Server:
- `{ type: "prompt", prompt, action?: "create"|"resume", skipPermissions?: boolean }`
- `{ type: "permission_response", toolUseID, approved, reason? }`

Server → Client:
- `{ type: "status", status: "starting"|"running"|"done" }`
- `{ type: "permission_request", toolUseID, toolName, input, suggestions? }`
- Stream events: `content_block_start`, `content_block_delta`, `content_block_stop`, `message_stop`
- Complete messages: `{ type: "assistant", message, source: "stream" }`
- `{ type: "result", ... }`

### Express 5

Express 5 route params are `string | string[]`, not just `string`. The `param()` helper in `api.ts` handles this. All IDs are sanitized via `sanitizeId()` (alphanumeric + dash + underscore only).

## Claude Code Data Layout (`~/.claude/`)

```
~/.claude/
├── settings.json              # hooks, permissions, general config
├── settings.local.json        # local overrides
├── projects/
│   └── {encoded-path}/        # e.g. C--Users-sawmi-agent-canvas
│       ├── sessions-index.json
│       ├── {uuid}.jsonl       # transcript file (one per session)
│       └── {uuid}/            # metadata dir (subagents/, tool-results/)
├── skills/
│   └── {skill-name}/SKILL.md  # YAML frontmatter + markdown body
└── plugins/
    └── installed_plugins.json
```

### Path Encoding

Project folder names encode the absolute path: every `-` is a path separator, `C--` is `C:\`.

**Gotcha**: `decodeProjectPath` is lossy — it can't distinguish hyphens-in-folder-names from path separators (e.g. `agent-canvas` decodes as `agent\canvas`). Use `resolveProjectPath()` instead, which peeks at the JSONL `system` message's `cwd` field to get the real filesystem path. This is critical for the file tree endpoint and project display.

### sessions-index.json

```json
{ "version": 1, "entries": [{ "sessionId": "uuid", "fullPath": "...", "summary": "...", ... }] }
```

**Gotcha**: Most JSONL files get cleaned up by Claude Code over time. The index references files that no longer exist. Always check `hasTranscript` before attempting to load.

### JSONL Transcript Format

Each line is a JSON object. Key `type` values:
- `system` — first line, contains `cwd`, `gitBranch`, `sessionId`, `version`
- `user` — user message. `message.content` is `string` or `ContentBlock[]`
- `assistant` — model response. `message.content` is always `ContentBlock[]`
- `result` — tool results
- `progress`, `file-history-snapshot`, `queue-operation` — internal, skip these

Content block types within assistant messages:
- `text` → `{ type: "text", text: "..." }`
- `thinking` → `{ type: "thinking", thinking: "..." }`
- `tool_use` → `{ type: "tool_use", id, name, input }`

Lines can be very large (thinking blocks). `readJSONLLines` uses Node.js `readline` for streaming.

## Backend API

| Endpoint | Response |
|----------|----------|
| `GET /api/projects` | `Project[]` |
| `GET /api/projects/:id/sessions` | `Session[]` (includes `isActive`, `lastToolUse`, `filesTouched`) |
| `GET /api/projects/:id/filetree` | `FileNode` tree (uses `resolveProjectPath`) |
| `GET /api/projects/:id/file?path=` | `FileContent` (single file, path-traversal protected) |
| `GET /api/sessions/:projectID/:sessionID/transcript?limit=N&offset=M` | `TranscriptMessage[]` (paginated from end) |
| `POST /api/sessions/:projectID/:sessionID/archive` | Archives session |
| `GET /api/skills` | `Skill[]` |
| `GET /api/config` | `Config` (hooks, plugins, permissions, settings, skills) |
| `WS /ws/sessions/:projectID/:sessionID` | Interactive session via Agent SDK |

### Session Discovery

`readSessions` merges two sources:
1. Entries from `sessions-index.json`
2. Orphan `.jsonl` files in the project directory not in the index

For sessions with missing metadata, `fillSessionMetadata` scans the JSONL to extract: first prompt, message count, git branch, project path.

### Active Session Detection

`enrichActiveSession` uses two signals:
1. **Primary**: `~/.claude/file-history/{sessionId}/` — updated during tool execution (mid-response), 5-minute window
2. **Fallback**: JSONL modification time — only updates after a complete response, 2-minute window

**Gotcha**: Claude writes the full assistant response as a single JSONL line *after* the response completes. During long generations, the JSONL is stale. `file-history` is the reliable signal.

### Worktree Merging

Worktree sessions (e.g. `C--Users-sawmi-agent-canvas--claude-worktrees-light-mode`) are automatically merged into the parent project. `isWorktreeProject()` detects paths containing `\.claude\worktrees\` and `findWorktreeProjectIDs()` collects them. `readSessions`, `readProjects`, and `readTranscript` all handle this transparently.

For active sessions, `tailSessionActivity` reads the last 1MB of the JSONL to extract `lastToolUse`, `lastToolTarget`, and `filesTouched`. This powers the live session indicators (green dot, LIVE badge, activity text, file pills).

## Frontend

| Hook | Purpose |
|------|---------|
| `useProjects()` | Fetch all projects on mount |
| `useSessions(projectId)` | Fetch sessions for selected project, polls every 10s |
| `useSkills()` | Fetch all skills on mount |
| `useConfig()` | Fetch aggregated config on mount |
| `fetchTranscript(projectId, sessionId, limit?, offset?)` | One-shot transcript fetch with pagination |
| `useSessionWS(projectId, sessionId)` | WebSocket hook for live sessions, streaming, and permissions |

### State Persistence

`selectedProjectId` and `skipPermissions` are persisted to `localStorage`.

### Session Cards

Active sessions display: pulsing green dot, "LIVE" badge, green left border, activity description (e.g. "Editing sessions.ts"), and file pills showing touched files. `DetailPane` auto-scrolls to bottom on load.

### Permission UI

When `skipPermissions` is off, tool use triggers an Allow/Deny prompt (`PermissionPrompt` component) in both `ChatPane` and `DetailPane`. The prompt shows tool name, a smart summary of the input (command for Bash, file path for Read/Write/Edit, pattern for Glob/Grep), and Allow/Deny buttons. Approval resolves the SDK's `canUseTool` promise and the tool executes.

## Workflow

Always work in a separate git worktree for each task to avoid conflicts with simultaneous sessions.

**CRITICAL: Never copy worktree files over the main repo.** Worktrees branch from an older commit and don't have changes made by other sessions. Copying files from a worktree into the main repo will silently overwrite those changes. Instead, merge worktree branches using `git merge` so conflicts are surfaced properly.

## Dev

```bash
# Backend (dev with hot reload)
cd backend && npm install && npm run dev

# Frontend (dev server on :5173, proxies API + WS to :3333)
cd frontend && npm install && npm run dev

# Type check
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# Production build
cd frontend && npm run build   # outputs to frontend/dist/
cd backend && npm run build    # outputs to backend/dist/
cd backend && npm start        # serves API + frontend/dist/ on :3333
```
