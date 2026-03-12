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
  filesTouched?: string[];
}

export interface TranscriptMessage {
  type: string;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
  };
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
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
  hooks: {
    type: string;
    prompt?: string;
    command?: string;
    timeout?: number;
  }[];
}

export interface Plugin {
  name: string;
  installs: {
    scope: string;
    projectPath?: string;
    installPath: string;
    version: string;
    installedAt: string;
  }[];
}

export interface Config {
  hooks: Hook[];
  plugins: Plugin[];
  skills: Skill[];
  settings: Record<string, unknown>;
  permissions: Record<string, unknown>;
}

export interface CanvasNode {
  id: string;
  type: 'project' | 'session' | 'skill' | 'config';
  x: number;
  y: number;
  data: Project | Session | Skill | Config;
  projectId?: string;
}
