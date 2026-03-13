export interface Project {
  id: string;
  path: string;
  encodedName: string;
  sessionCount: number;
  lastModified: string;
}

export interface Session {
  sessionId: string;
  fullPath: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
  hasTranscript: boolean;
  isActive: boolean;
  lastToolUse?: string;
  lastToolTarget?: string;
  filesTouched?: string[];
  cronJobs?: CronJob[];
}

export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
}

export interface SessionsIndex {
  version: number;
  entries: Session[];
}

export interface TranscriptMessage {
  type: string;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  message?: MessageObj;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
}

export interface MessageObj {
  role: string;
  content: string | ContentBlock[];
  model?: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
}

export interface Skill {
  name: string;
  description: string;
  trigger: string;
  matchTools: string[];
  filePath: string;
  body: string;
}

export interface Hook {
  event: string;
  matcher: string;
  hooks: HookDef[];
}

export interface HookDef {
  type: string;
  prompt?: string;
  command?: string;
  timeout?: number;
}

export interface Plugin {
  name: string;
  installs: PluginInstall[];
}

export interface PluginInstall {
  scope: string;
  projectPath?: string;
  installPath: string;
  version: string;
  installedAt: string;
}

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  name: string;
  content: string;
  language: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
}

export interface Config {
  hooks: Hook[];
  plugins: Plugin[];
  skills: Skill[];
  settings: Record<string, unknown>;
  permissions: Record<string, unknown>;
}
