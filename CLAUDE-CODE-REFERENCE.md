# Claude Code Local Architecture Reference

Comprehensive reference for building tools that integrate with Claude Code's local state. Compiled from official docs (code.claude.com, docs.anthropic.com) and the open-source repo (github.com/anthropics/claude-code).

---

## 1. Session Management

### Session Lifecycle

- **Creation**: Each `claude` invocation creates a new session with a UUID. Stored as `~/.claude/projects/{encoded-path}/{sessionId}.jsonl`.
- **Index**: `sessions-index.json` in the same directory tracks all sessions for that project.
- **Cleanup**: Controlled by `cleanupPeriodDays` (default **30 days**). Sessions older than this are deleted **at startup**. Setting to `0` deletes all transcripts at startup and disables persistence entirely.
- **Resumption**: Full conversation history is restored. Session-scoped permissions (one-time allows) are NOT restored.

### CLI Flags

| Flag | Behavior |
|------|----------|
| `--continue` / `-c` | Resume most recent conversation in current directory |
| `--resume` / `-r <id>` | Resume specific session by ID or name |
| `--resume` (no arg) | Interactive session picker |
| `--session-id <uuid>` | Force specific UUID for new session |
| `--fork-session` | With `--resume`: new ID, inherits history. Original unchanged. |
| `--from-pr <number\|url>` | Resume sessions linked to a PR |
| `--no-session-persistence` | Print mode only. Session not saved to disk. |

### Concurrent Access

If you resume the same session in multiple terminals, both write to the same JSONL. Messages interleave. Nothing corrupts, but conversation becomes jumbled. Use `--fork-session` for clean parallel work.

### Resuming Non-Existent Sessions

Returns `{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["No conversation found with session ID: ..."]}` in stream-json mode. Process exits immediately with this single line of output.

### sessions-index.json Schema

```json
{
  "version": 1,
  "entries": [{
    "sessionId": "uuid",
    "fullPath": "/absolute/path/to/{uuid}.jsonl",
    "summary": "Short description",
    "firstPrompt": "Initial user prompt (max 200 chars)",
    "messageCount": 42,
    "created": "ISO 8601",
    "modified": "ISO 8601",
    "gitBranch": "main",
    "projectPath": "/path/to/project",
    "isSidechain": false
  }]
}
```

**Gotcha**: Index references files that may have been cleaned up. Always check file existence before loading.

---

## 2. JSONL Transcript Format

Each line is a standalone JSON object. Lines can be extremely large (thinking blocks). Use 10MB+ scanner buffer.

### Message Types

| Type | Description |
|------|-------------|
| `system` | First line. Fields: `cwd`, `gitBranch`, `sessionId`, `version`. Also appears with `subtype: "compact_boundary"` after compaction. |
| `user` | User message. `message.content` is `string` or `ContentBlock[]` |
| `assistant` | Model response. `message.content` is always `ContentBlock[]`. `message.model` contains model ID. |
| `result` | Tool results. Contains `tool_result` blocks with `tool_use_id` and `content`. |
| `progress` | Internal, skip. |
| `file-history-snapshot` | Internal, skip. |
| `queue-operation` | Internal, skip. |

### Content Block Types (within assistant messages)

- `text`: `{ type: "text", text: "..." }`
- `thinking`: `{ type: "thinking", thinking: "..." }` — can be very large
- `tool_use`: `{ type: "tool_use", id: "toolu_...", name: "ToolName", input: {...} }`

### Common Fields Per Line

`type`, `uuid`, `parentUuid` (nullable), `timestamp`, `message` (with `role`, `content`, optionally `model`), `sessionId`, `cwd`, `gitBranch`.

### Write Timing

Claude writes the full assistant response as a **single JSONL line after the response completes**. During long generations (thinking + tool use), the JSONL is stale. Use `file-history/` as the reliable activity signal.

---

## 3. Scheduled Tasks / Cron

### Session-Scoped Tasks (CronCreate/CronDelete/CronList)

- **In-memory only.** Die when the Claude process exits. Do NOT survive restarts.
- **Max 50 tasks** per session.
- **3-day auto-expiry** for recurring tasks.
- **Execution**: Fires between user turns, not mid-response. If Claude is busy, task waits.
- **No catch-up**: Missed runs fire once when idle, not once per missed interval.
- **Disable**: `CLAUDE_CODE_DISABLE_CRON=1`

### Jitter

- Recurring: up to 10% of period late, capped at 15 minutes (deterministic per task ID).
- One-shot at :00 or :30: up to 90 seconds early.

### `/loop` Skill

`/loop [interval] <prompt>` — default 10 minutes. Intervals like `30m`, `2h`, `1d`.

### Desktop Scheduled Tasks (Durable)

Separate system via Desktop app. Stored at `~/.claude/scheduled-tasks/<task-name>/SKILL.md`. Survives restarts. Each run creates a new session. Catches up missed runs from last 7 days.

---

## 4. File History & Checkpoints

### `~/.claude/file-history/{sessionId}/`

- Updated **during tool execution** (mid-response), not after completion.
- Primary signal for active session detection (5-minute recency window).
- Contains file snapshots taken before Claude edits a file.
- Only tracks edits via Claude's tools (Edit, Write). NOT: bash commands, manual edits, other sessions.

### Checkpointing

- Every user prompt creates a checkpoint automatically.
- `/rewind` or `Esc+Esc` opens checkpoint picker with options: restore code+conversation, restore conversation only, restore code only, summarize from point.
- Cleaned up along with sessions after `cleanupPeriodDays`.
- NOT a replacement for version control.

---

## 5. Hooks System

### Hook Events

| Event | When | Can Block? | Matcher |
|-------|------|-----------|---------|
| `SessionStart` | Session begins/resumes | No | `startup`, `resume`, `clear`, `compact` |
| `InstructionsLoaded` | CLAUDE.md loaded | No | — |
| `UserPromptSubmit` | User submits prompt | Yes | — |
| `PreToolUse` | Before tool executes | Yes | tool name |
| `PermissionRequest` | Permission dialog | Yes | tool name |
| `PostToolUse` | After tool succeeds | No (feedback) | tool name |
| `PostToolUseFailure` | After tool fails | No (feedback) | tool name |
| `Notification` | Claude notification | No | `permission_prompt`, `idle_prompt`, etc. |
| `SubagentStart` | Subagent spawned | No (context injection) | agent type |
| `SubagentStop` | Subagent finishes | Yes | agent type |
| `Stop` | Claude finishes responding | Yes | — |
| `TaskCompleted` | Task marked complete | Yes | — |
| `ConfigChange` | Config file changes | Yes (except policy) | file type |
| `WorktreeCreate` | Worktree created | Yes | — |
| `WorktreeRemove` | Worktree removed | No | — |
| `PreCompact` | Before compaction | No | `manual`, `auto` |
| `SessionEnd` | Session terminates | No | reason type |

### Handler Types

1. **Command** (`type: "command"`): Shell command, JSON on stdin, exit codes + stdout JSON.
2. **HTTP** (`type: "http"`): POST request, same JSON format.
3. **Prompt** (`type: "prompt"`): LLM evaluation for yes/no decisions.
4. **Agent** (`type: "agent"`): Subagent with tool access.

### Hook Input (stdin JSON)

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/current/working/dir",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "agent_id": "optional",
  "agent_type": "optional"
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success. Parse stdout JSON. |
| 2 | Blocking error. stderr fed back to Claude. |
| Other | Non-blocking. stderr in verbose mode only. |

### Hook Output (stdout JSON on exit 0)

```json
{
  "continue": true,
  "stopReason": "message for user",
  "decision": "block",
  "reason": "explanation",
  "hookSpecificOutput": {
    "permissionDecision": "allow|deny|ask",
    "updatedInput": { "field": "new value" }
  }
}
```

### Matcher Patterns

Regex strings. `"*"`, `""`, or omitted = match all. Examples: `Bash`, `Edit|Write`, `mcp__.*`.

### Configuration Locations (Precedence)

1. Managed policy settings (highest)
2. `.claude/settings.json` (project, committed)
3. `.claude/settings.local.json` (project, gitignored)
4. `~/.claude/settings.json` (user)
5. Plugin `hooks/hooks.json`
6. Skill/agent frontmatter

**Hooks are snapshotted at startup.** Mid-session changes require `/hooks` review.

### Timeouts

Command: 600s, Prompt: 30s, Agent: 60s, SessionEnd: 1.5s.

---

## 6. Permissions & Trust

### Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Prompts on first use |
| `acceptEdits` | Auto-accepts file edits, asks for commands |
| `plan` | Read-only analysis |
| `dontAsk` | Auto-denies unless pre-approved |
| `bypassPermissions` | Skips all checks (container use only) |

### Permission Rule Syntax

Format: `Tool` or `Tool(specifier)`. Evaluated: **deny → ask → allow**.

- `Bash(npm run *)`: commands starting with `npm run`
- `Read(./.env)`: specific file
- `Edit(/src/**/*.ts)`: gitignore-style pattern
- `WebFetch(domain:example.com)`: domain filter
- `MCP(serverName.toolName)`: MCP tool

Path prefixes: `//` = filesystem root, `~/` = home, `/` = project root, `./` = cwd.

---

## 7. Settings System

### Settings Precedence (Highest → Lowest)

1. **Managed** (MDM/registry/`managed-settings.json`)
2. **CLI arguments**
3. **Local** (`.claude/settings.local.json` — gitignored)
4. **Project** (`.claude/settings.json` — committed)
5. **User** (`~/.claude/settings.json`)

Array-valued settings (permissions, sandbox paths) are **concatenated and deduplicated**, not replaced.

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cleanupPeriodDays` | 30 | Session cleanup age |
| `model` | — | Model override |
| `permissions` | — | Allow/ask/deny rules, `defaultMode` |
| `hooks` | — | Hook configuration |
| `outputStyle` | — | Response style |
| `language` | — | Language preference |
| `respectGitignore` | true | Honor .gitignore |

### CLAUDE.md Loading Order

1. Managed policy CLAUDE.md (system paths)
2. Walk UP directory tree from cwd (each `CLAUDE.md` or `.claude/CLAUDE.md`)
3. `~/.claude/CLAUDE.md` (user global)
4. `.claude/rules/*.md` files
5. Auto memory: first 200 lines of `~/.claude/projects/<project>/memory/MEMORY.md`

Subdirectory CLAUDE.md files are lazily loaded when Claude reads files in those directories.

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | API key |
| `ANTHROPIC_MODEL` | Model override |
| `CLAUDE_CODE_EFFORT_LEVEL` | low/medium/high |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Default 32000, max 64000 |
| `CLAUDE_CODE_SHELL` | Override shell |
| `CLAUDE_CODE_DISABLE_CRON` | Disable scheduled tasks |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | Disable auto memory |
| `CLAUDE_CODE_SIMPLE` | Minimal mode |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Subagent model |
| `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` | Compaction trigger % |
| `CLAUDE_CODE_TASK_LIST_ID` | Share task list across sessions |
| `BASH_DEFAULT_TIMEOUT_MS` | Default bash timeout |
| `MAX_MCP_OUTPUT_TOKENS` | Default 25000 |
| `MCP_TIMEOUT` | MCP startup timeout |

---

## 8. Projects & Path Encoding

### Encoding

Every `-` in the folder name is a path separator. `C--` is `C:\`.

Example: `C--Users-sawmi-agent-canvas` → `C:\Users\sawmi\agent\canvas`

**Gotcha**: Lossy. `agent-canvas` decodes as `agent\canvas`. Use `resolveProjectPath()` which reads `cwd` from the JSONL system message.

### Worktrees

- Created at `<repo>/.claude/worktrees/<name>/`
- Branch named `worktree-<name>`
- Sessions automatically merged into parent project in UI
- **No changes on exit**: worktree + branch removed automatically
- **Changes exist**: Claude prompts to keep or remove

---

## 9. Subagents

### Built-in Types

| Agent | Model | Tools | Purpose |
|-------|-------|-------|---------|
| Explore | Haiku | Read-only | Codebase search |
| Plan | Inherit | Read-only | Research for planning |
| general-purpose | Inherit | All | Complex multi-step tasks |
| Bash | Inherit | Terminal | Commands in separate context |
| Claude Code Guide | Haiku | — | Questions about Claude Code |

### Configuration (YAML Frontmatter in .md files)

Fields: `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `isolation` (worktree).

### Storage

Transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`

### Constraints

- **Cannot nest** — subagents cannot spawn other subagents
- Don't inherit parent's skills; must be listed explicitly
- `context: fork` in skills runs in a forked subagent context

---

## 10. CLI Output Formats

### `--output-format stream-json`

Newline-delimited JSON. Each line is a valid JSON object.

| Event Type | Description |
|------------|-------------|
| `system` | Session initialization |
| `assistant` | Complete assistant message with all content blocks |
| `result` | Final result (includes `is_error`, `errors[]`, `session_id`, usage) |

With `--include-partial-messages`, also emits raw streaming events:
- `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`

### `--output-format json`

Single JSON object at end: `{ "result": "...", "session_id": "...", "usage": {...} }`

### Error Result Format

```json
{
  "type": "result",
  "subtype": "error_during_execution",
  "is_error": true,
  "errors": ["Error message here"],
  "session_id": "uuid",
  "duration_ms": 0,
  "num_turns": 0
}
```

---

## 11. MCP Integration

### Configuration Files

| Scope | File |
|-------|------|
| User/Local | `~/.claude.json` |
| Project | `.mcp.json` in project root |
| Managed | `managed-mcp.json` in system directories |

### Transport Types

- **HTTP** (recommended): `claude mcp add --transport http <name> <url>`
- **SSE** (deprecated): `claude mcp add --transport sse <name> <url>`
- **stdio**: `claude mcp add --transport stdio <name> -- <command> [args...]`

### Tool Search

When MCP tools exceed 10% of context window, tools are deferred and discovered on-demand via `MCPSearch`. Configurable via `ENABLE_TOOL_SEARCH`.

### Limits

- Warning at 10,000 tokens output
- Max 25,000 tokens (configurable via `MAX_MCP_OUTPUT_TOKENS`)

---

## 12. Data Storage Layout

```
~/.claude/
├── settings.json                    # User settings
├── settings.local.json              # Local overrides
├── CLAUDE.md                        # User-level instructions
├── rules/                           # User-level rules (*.md)
├── agents/                          # User-level subagent definitions
├── skills/                          # User-level skills
├── agent-memory/                    # Subagent persistent memory
├── projects/
│   └── {encoded-path}/
│       ├── sessions-index.json
│       ├── {uuid}.jsonl             # Session transcripts
│       ├── {uuid}/subagents/        # Subagent transcripts
│       └── memory/                  # Auto-memory for project
│           ├── MEMORY.md            # Index (first 200 lines loaded)
│           └── {topic}.md           # Topic files
├── file-history/
│   └── {sessionId}/                 # File checkpoints
├── plugins/installed_plugins.json
├── teams/{name}/config.json         # Agent teams
├── tasks/{team}/                    # Shared task lists
└── .claude.json                     # MCP server configs (also ~/.claude.json)
```

### Project-Level `.claude/`

```
.claude/
├── settings.json                    # Project settings (committed)
├── settings.local.json              # Local settings (gitignored)
├── CLAUDE.md                        # Project instructions
├── rules/*.md                       # Project rules
├── agents/*.md                      # Project subagents
├── skills/{name}/SKILL.md           # Project skills
├── agent-memory/{name}/             # Subagent memory (committed)
├── agent-memory-local/{name}/       # Subagent memory (gitignored)
├── commands/{name}.md               # Legacy commands
└── worktrees/{name}/                # Git worktrees
```

### External Modification Safety

| Safe to read | Safe to modify | NOT safe to modify during active session |
|-------------|---------------|----------------------------------------|
| All files | settings*.json | JSONL transcripts |
| sessions-index.json | CLAUDE.md files | file-history/ |
| file-history/ | Skills, agents, memory | sessions-index.json |

---

## Key Gotchas

1. **JSONL write timing**: Full response written as single line AFTER completion. Stale during generation. Use `file-history/` for activity detection.
2. **Path encoding is lossy**: `decodeProjectPath` can't distinguish hyphens from separators. Use `resolveProjectPath()`.
3. **Index staleness**: `sessions-index.json` references cleaned-up files. Always check existence.
4. **Compaction re-reads CLAUDE.md**: After `/compact`, instructions from CLAUDE.md survive but conversation-only instructions are lost.
5. **Hook snapshot**: Hooks captured at startup. Mid-session changes need `/hooks` review.
6. **Auto-memory 200-line limit**: Only first 200 lines of `MEMORY.md` loaded.
7. **Scanner buffer**: JSONL lines can exceed 10MB (thinking blocks).
8. **Subagents can't nest**: No spawning subagents from subagents.
9. **Crons are ephemeral**: Session-scoped, in-memory, 3-day expiry, die with process.
10. **Concurrent sessions**: Same JSONL = interleaved messages. Use `--fork-session`.
