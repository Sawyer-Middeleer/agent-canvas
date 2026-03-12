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

Project folder names encode the absolute path:
- `C--` → `C:\` (drive letter)
- Each `-` → `\` (path separator)
- Use raw encoded name as project ID in API calls; decode only for display.

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
| `GET /api/projects/{id}/sessions` | `Session[]` |
| `GET /api/sessions/{projectID}/{sessionID}/transcript?limit=N` | `TranscriptMessage[]` (last N) |
| `GET /api/skills` | `Skill[]` |
| `GET /api/config` | `Config` (hooks, plugins, permissions, settings, skills) |

IDs are sanitized to `[a-zA-Z0-9_-]` only.

### Session Discovery

`ReadSessions` merges two sources:
1. Entries from `sessions-index.json`
2. Orphan `.jsonl` files in the project directory not in the index

For sessions with transcripts but missing metadata (empty summary), `fillSessionMetadata` scans the JSONL to extract: first prompt, message count, git branch, project path.

## Frontend

| Hook | Purpose |
|------|---------|
| `useProjects()` | Fetch all projects on mount |
| `useSessions(projectId)` | Fetch sessions for selected project |
| `useSkills()` | Fetch all skills on mount |
| `useConfig()` | Fetch aggregated config on mount |
| `fetchTranscript(projectId, sessionId, limit?)` | One-shot transcript fetch |

### WebSocket (backend/ws.go)

`ws://localhost:3333/ws/sessions/{projectID}/{sessionID}` — resumes a session via `claude --resume` CLI, streams output as `stream-json` events.

## Dev

```bash
# Backend
cd backend && go build -o agent-canvas.exe . && ./agent-canvas.exe

# Frontend (dev server on :5173, proxies API to :3333)
cd frontend && npm install && npm run dev

# Type check
cd frontend && npx tsc --noEmit
```
