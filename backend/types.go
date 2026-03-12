package main

import "time"

// Project represents a Claude Code project directory
type Project struct {
	ID           string    `json:"id"`
	Path         string    `json:"path"`
	EncodedName  string    `json:"encodedName"`
	SessionCount int       `json:"sessionCount"`
	LastModified time.Time `json:"lastModified"`
}

// Session from sessions-index.json
type Session struct {
	SessionID      string   `json:"sessionId"`
	FullPath       string   `json:"fullPath"`
	FirstPrompt    string   `json:"firstPrompt"`
	Summary        string   `json:"summary"`
	MessageCount   int      `json:"messageCount"`
	Created        string   `json:"created"`
	Modified       string   `json:"modified"`
	GitBranch      string   `json:"gitBranch"`
	ProjectPath    string   `json:"projectPath"`
	IsSidechain    bool     `json:"isSidechain"`
	HasTranscript  bool     `json:"hasTranscript"`
	IsActive       bool     `json:"isActive"`
	LastToolUse    string   `json:"lastToolUse,omitempty"`
	LastToolTarget string   `json:"lastToolTarget,omitempty"`
	FilesTouched   []string `json:"filesTouched,omitempty"`
}

// SessionsIndex is the top-level structure of sessions-index.json
type SessionsIndex struct {
	Version int       `json:"version"`
	Entries []Session `json:"entries"`
}

// TranscriptMessage is a single line from a session JSONL transcript
type TranscriptMessage struct {
	Type      string      `json:"type"`
	UUID      string      `json:"uuid"`
	ParentUUID *string    `json:"parentUuid"`
	Timestamp string      `json:"timestamp"`
	Message   *MessageObj `json:"message,omitempty"`
	SessionID string      `json:"sessionId,omitempty"`
	CWD       string      `json:"cwd,omitempty"`
	GitBranch string      `json:"gitBranch,omitempty"`
}

// MessageObj is the inner message object
type MessageObj struct {
	Role    string        `json:"role"`
	Content interface{}   `json:"content"` // string or []ContentBlock
	Model   string        `json:"model,omitempty"`
}

// Skill parsed from SKILL.md frontmatter
type Skill struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Trigger     string   `json:"trigger,omitempty"`
	MatchTools  []string `json:"matchTools,omitempty"`
	FilePath    string   `json:"filePath"`
	Body        string   `json:"body"`
}

// Hook from settings.json
type Hook struct {
	Event   string     `json:"event"`
	Matcher string     `json:"matcher"`
	Hooks   []HookDef  `json:"hooks"`
}

type HookDef struct {
	Type    string `json:"type"`
	Prompt  string `json:"prompt,omitempty"`
	Command string `json:"command,omitempty"`
	Timeout int    `json:"timeout,omitempty"`
}

// Plugin from installed_plugins.json
type Plugin struct {
	Name        string          `json:"name"`
	Installs    []PluginInstall `json:"installs"`
}

type PluginInstall struct {
	Scope       string `json:"scope"`
	ProjectPath string `json:"projectPath,omitempty"`
	InstallPath string `json:"installPath"`
	Version     string `json:"version"`
	InstalledAt string `json:"installedAt"`
}

// FileNode represents a file or directory in the project tree
type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"isDir"`
	Children []FileNode `json:"children,omitempty"`
}

// Config is the aggregated configuration view
type Config struct {
	Hooks       []Hook            `json:"hooks"`
	Plugins     []Plugin          `json:"plugins"`
	Skills      []Skill           `json:"skills"`
	Settings    map[string]interface{} `json:"settings"`
	Permissions map[string]interface{} `json:"permissions"`
}
