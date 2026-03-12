# Agent Canvas

Miro-style infinite canvas for visualizing Claude Code local state — projects, sessions, transcripts, skills, hooks, and config.

## Architecture

- **Backend** (`backend/`): Go HTTP server on `:3333`. Reads `~/.claude/` filesystem directly. No database.
- **Frontend** (`frontend/`): React + TypeScript + Vite. Uses `react-zoom-pan-pinch` for the infinite canvas.

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

**Gotcha**: Most JSONL files get cleaned up by Claude Code over time. The index references files that no longer exist. Always check `HasTranscript` before attempting to load.

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

Lines can be very large (thinking blocks). Use 10MB+ scanner buffer.

## Backend API

| Endpoint | Response |
|----------|----------|
| `GET /api/projects` | `Project[]` |
| `GET /api/projects/{id}/sessions` | `Session[]` (includes `isActive`, `lastToolUse`, `filesTouched`) |
| `GET /api/projects/{id}/filetree` | `FileNode` tree (uses `resolveProjectPath`) |
| `GET /api/sessions/{projectID}/{sessionID}/transcript?limit=N` | `TranscriptMessage[]` (last N) |
| `GET /api/skills` | `Skill[]` |
| `GET /api/config` | `Config` (hooks, plugins, permissions, settings, skills) |

IDs are sanitized to `[a-zA-Z0-9_-]` only.

### Session Discovery

`ReadSessions` merges two sources:
1. Entries from `sessions-index.json`
2. Orphan `.jsonl` files in the project directory not in the index

For sessions with transcripts but missing metadata (empty summary), `fillSessionMetadata` scans the JSONL to extract: first prompt, message count, git branch, project path.

### Active Session Detection

`enrichActiveSession` uses two signals to detect active sessions:
1. **Primary**: `~/.claude/file-history/{sessionId}/` — updated during tool execution (mid-response), 5-minute window
2. **Fallback**: JSONL modification time — only updates after a complete response, 2-minute window

**Gotcha**: Claude writes the full assistant response as a single JSONL line *after* the response completes. During long generations (thinking + tool use), the JSONL is stale. `file-history` is the reliable signal.

Worktree sessions (e.g. `C--Users-sawmi-agent-canvas--claude-worktrees-light-mode`) are automatically merged into the parent project in the UI. `isWorktreeProject()` detects paths containing `\.claude\worktrees\` and `findWorktreeProjectIDs()` collects them. `ReadSessions`, `ReadProjects`, and `ReadTranscript` all handle this transparently.

For active sessions, `tailSessionActivity` reads the last 1MB of the JSONL to extract:
- `lastToolUse` / `lastToolTarget` — most recent tool_use block name and file_path
- `filesTouched` — deduplicated list of `file_path` values from tool_use inputs

This data powers the live session indicators in the frontend (green dot, LIVE badge, activity text, file pills).

## Frontend

| Hook | Purpose |
|------|---------|
| `useProjects()` | Fetch all projects on mount |
| `useSessions(projectId)` | Fetch sessions for selected project, polls every 10s |
| `useSkills()` | Fetch all skills on mount |
| `useConfig()` | Fetch aggregated config on mount |
| `fetchTranscript(projectId, sessionId, limit?)` | One-shot transcript fetch |

### State Persistence

`selectedProjectId` is persisted to `localStorage` so the selected project survives page refreshes. On load, validates the stored ID still exists in the project list before using it.

### Session Cards

Active sessions display: pulsing green dot, "LIVE" badge, green left border, activity description (e.g. "Editing state.go"), and file pills showing touched files. `DetailPane` auto-scrolls to bottom on load and polls every 5s for active sessions.

### WebSocket (backend/ws.go)

`ws://localhost:3333/ws/sessions/{projectID}/{sessionID}` — resumes a session via `claude --resume` CLI, streams output as `stream-json` events.

## Workflow

Always work in a separate git worktree for each task to avoid conflicts with simultaneous sessions.

**CRITICAL: Never copy worktree files over the main repo.** Worktrees branch from an older commit and don't have changes made by other sessions. Copying files from a worktree into the main repo will silently overwrite those changes. Instead, merge worktree branches using `git merge` so conflicts are surfaced properly.

## Dev

```bash
# Backend
cd backend && go build -o agent-canvas.exe . && ./agent-canvas.exe

# Frontend (dev server on :5173, proxies API to :3333)
cd frontend && npm install && npm run dev

# Type check
cd frontend && npx tsc --noEmit
```
