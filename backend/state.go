package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// claudeDir returns the path to ~/.claude
func claudeDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude")
}

// decodeProjectPath converts "C--Users-sawmi-open-crm" back to "C:\Users\sawmi\open-crm"
// Double dashes "--" encode path separators, single dashes "-" encode spaces or hyphens.
// Since sessions-index.json contains the actual projectPath, we use that when available.
// This is a best-effort decode for display only.
func decodeProjectPath(encoded string) string {
	// Replace leading drive letter pattern: "C--" -> "C:\"
	if len(encoded) >= 3 && encoded[1] == '-' && encoded[2] == '-' {
		encoded = string(encoded[0]) + ":\\" + encoded[3:]
	}
	// Replace remaining "--" with "\" (path separator), then single "-" with "\"
	// Actually the encoding is simple: every "-" is a path separator
	return strings.ReplaceAll(encoded, "-", "\\")
}

// resolveProjectPath tries to find the real project path by peeking at JSONL files.
// The folder encoding is lossy, so we read the cwd from the first JSONL transcript.
func resolveProjectPath(projectID string) string {
	projectDir := filepath.Join(claudeDir(), "projects", projectID)
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return decodeProjectPath(projectID)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".jsonl") {
			if cwd := peekCWD(filepath.Join(projectDir, e.Name())); cwd != "" {
				return cwd
			}
		}
	}
	return decodeProjectPath(projectID)
}

// peekCWD reads the first line of a JSONL file looking for the system init cwd.
func peekCWD(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	if scanner.Scan() {
		var peek struct {
			Type string `json:"type"`
			CWD  string `json:"cwd"`
		}
		if json.Unmarshal(scanner.Bytes(), &peek) == nil && peek.Type == "system" && peek.CWD != "" {
			return peek.CWD
		}
	}
	return ""
}

// ReadProjects lists all projects from ~/.claude/projects/
func ReadProjects() ([]Project, error) {
	projectsDir := filepath.Join(claudeDir(), "projects")
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil, fmt.Errorf("reading projects dir: %w", err)
	}

	var projects []Project
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		info, _ := entry.Info()

		// Count sessions (use ReadSessions which merges index + orphan JSONL)
		sessCount := 0
		if ss, err := ReadSessions(name); err == nil {
			sessCount = len(ss)
		}

		projects = append(projects, Project{
			ID:           name,
			Path:         decodeProjectPath(name),
			EncodedName:  name,
			SessionCount: sessCount,
			LastModified: info.ModTime(),
		})
	}
	return projects, nil
}

// readSessionsIndex reads sessions-index.json from a project directory
func readSessionsIndex(projectDir string) (*SessionsIndex, error) {
	data, err := os.ReadFile(filepath.Join(projectDir, "sessions-index.json"))
	if err != nil {
		return nil, err
	}
	var idx SessionsIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, err
	}
	return &idx, nil
}

// ReadSessions returns sessions for a given project ID.
// It merges sessions-index.json entries with any orphan JSONL files
// and marks which sessions have transcripts on disk.
func ReadSessions(projectID string) ([]Session, error) {
	projectDir := filepath.Join(claudeDir(), "projects", projectID)

	// Collect indexed sessions
	var sessions []Session
	indexed := map[string]bool{}
	idx, err := readSessionsIndex(projectDir)
	if err == nil {
		for i := range idx.Entries {
			s := &idx.Entries[i]
			// Check if transcript file exists
			s.HasTranscript = transcriptExists(projectDir, s.SessionID, s.FullPath)
			indexed[s.SessionID] = true
		}
		sessions = idx.Entries
	}

	// Discover orphan JSONL files not in the index
	entries, _ := os.ReadDir(projectDir)
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		sid := strings.TrimSuffix(name, ".jsonl")
		if indexed[sid] {
			continue
		}
		info, _ := e.Info()
		mod := ""
		if info != nil {
			mod = info.ModTime().Format("2006-01-02T15:04:05.000Z")
		}
		s := Session{
			SessionID:     sid,
			FullPath:      filepath.Join(projectDir, name),
			HasTranscript: true,
			Modified:      mod,
			Created:       mod,
		}
		fillSessionMetadata(&s)
		sessions = append(sessions, s)
	}

	// Backfill metadata for indexed sessions that have transcripts but empty summaries
	for i := range sessions {
		s := &sessions[i]
		if s.HasTranscript && s.Summary == "" {
			fillSessionMetadata(s)
		}
	}

	// Enrich all sessions with filesTouched
	for i := range sessions {
		enrichSessionFiles(&sessions[i], projectDir)
	}

	if len(sessions) == 0 {
		return nil, fmt.Errorf("no sessions found")
	}
	return sessions, nil
}

// --- filesTouched cache ---
var (
	fileTouchCache   = map[string]fileTouchEntry{}
	fileTouchCacheMu sync.Mutex
)

type fileTouchEntry struct {
	modTime      os.FileInfo
	filesTouched []string
}

// enrichSessionFiles scans the JSONL for tool_use file paths and populates FilesTouched.
func enrichSessionFiles(s *Session, projectDir string) {
	if !s.HasTranscript {
		return
	}

	jsonlPath := filepath.Join(projectDir, s.SessionID+".jsonl")
	if s.FullPath != "" {
		normalized := filepath.FromSlash(strings.ReplaceAll(s.FullPath, "\\", "/"))
		if _, err := os.Stat(normalized); err == nil {
			jsonlPath = normalized
		}
	}

	info, err := os.Stat(jsonlPath)
	if err != nil {
		return
	}

	fileTouchCacheMu.Lock()
	if cached, ok := fileTouchCache[s.SessionID]; ok && cached.modTime != nil &&
		cached.modTime.ModTime().Equal(info.ModTime()) && cached.modTime.Size() == info.Size() {
		s.FilesTouched = cached.filesTouched
		fileTouchCacheMu.Unlock()
		return
	}
	fileTouchCacheMu.Unlock()

	touched := tailSessionActivity(jsonlPath, s.ProjectPath)
	s.FilesTouched = touched

	fileTouchCacheMu.Lock()
	fileTouchCache[s.SessionID] = fileTouchEntry{modTime: info, filesTouched: touched}
	fileTouchCacheMu.Unlock()
}

// tailSessionActivity scans a JSONL file for tool_use blocks that reference file paths.
func tailSessionActivity(jsonlPath, projectRoot string) []string {
	if projectRoot == "" {
		projectRoot = peekCWD(jsonlPath)
	}

	f, err := os.Open(jsonlPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	filesTouched := map[string]bool{}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		// Quick check — only parse lines that might have tool_use
		if !strings.Contains(string(line), "tool_use") {
			continue
		}

		var entry struct {
			Type    string `json:"type"`
			Message *struct {
				Content []struct {
					Type  string                 `json:"type"`
					Name  string                 `json:"name"`
					Input map[string]interface{} `json:"input"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(line, &entry) != nil || entry.Message == nil {
			continue
		}
		for _, block := range entry.Message.Content {
			if block.Type != "tool_use" {
				continue
			}
			// Extract file paths from common tool inputs
			for _, key := range []string{"file_path", "path", "command"} {
				raw, ok := block.Input[key]
				if !ok {
					continue
				}
				fp, ok := raw.(string)
				if !ok || fp == "" {
					continue
				}
				// For "command" key, try to extract file paths from the command string
				if key == "command" {
					continue // skip command strings, too noisy
				}
				// Make path relative to project root
				display := fp
				if projectRoot != "" {
					if rel, err := filepath.Rel(projectRoot, fp); err == nil {
						display = filepath.ToSlash(rel)
					}
				}
				// Skip paths that go outside the project
				if strings.HasPrefix(display, "..") {
					continue
				}
				filesTouched[display] = true
			}
		}
	}

	result := make([]string, 0, len(filesTouched))
	for f := range filesTouched {
		result = append(result, f)
	}
	return result
}

// fillSessionMetadata reads the JSONL file to extract metadata
// (first prompt, message count, git branch, project path) for sessions
// that are missing this info (orphan files or stale index entries).
func fillSessionMetadata(s *Session) {
	if s.FullPath == "" {
		return
	}
	normalized := filepath.FromSlash(strings.ReplaceAll(s.FullPath, "\\", "/"))
	f, err := os.Open(normalized)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024)

	msgCount := 0
	firstUserText := ""

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		// Quick type peek to avoid full parse of large assistant messages
		var peek struct {
			Type    string `json:"type"`
			CWD     string `json:"cwd"`
			Branch  string `json:"gitBranch"`
			Message *struct {
				Role    string      `json:"role"`
				Content interface{} `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(line, &peek); err != nil {
			continue
		}

		// Extract branch/cwd from the system init message
		if peek.Type == "system" {
			if s.GitBranch == "" && peek.Branch != "" {
				s.GitBranch = peek.Branch
			}
			if s.ProjectPath == "" && peek.CWD != "" {
				s.ProjectPath = peek.CWD
			}
			continue
		}

		if peek.Type == "user" || peek.Type == "assistant" {
			msgCount++
		}

		// Grab first user prompt text
		if peek.Type == "user" && firstUserText == "" && peek.Message != nil && peek.Message.Role == "user" {
			switch c := peek.Message.Content.(type) {
			case string:
				firstUserText = c
			case []interface{}:
				for _, block := range c {
					if bm, ok := block.(map[string]interface{}); ok {
						if bm["type"] == "text" {
							if t, ok := bm["text"].(string); ok {
								firstUserText = t
								break
							}
						}
					}
				}
			}
		}
	}

	s.MessageCount = msgCount
	if s.FirstPrompt == "" && firstUserText != "" {
		if len(firstUserText) > 200 {
			s.FirstPrompt = firstUserText[:200]
		} else {
			s.FirstPrompt = firstUserText
		}
	}
	// Use first prompt as summary if no summary exists
	if s.Summary == "" && firstUserText != "" {
		line := strings.SplitN(firstUserText, "\n", 2)[0]
		if len(line) > 100 {
			line = line[:100]
		}
		s.Summary = line
	}
}

// transcriptExists checks whether a JSONL transcript file is available on disk.
func transcriptExists(projectDir, sessionID, fullPath string) bool {
	// Try direct path
	if _, err := os.Stat(filepath.Join(projectDir, sessionID+".jsonl")); err == nil {
		return true
	}
	// Try fullPath from index
	if fullPath != "" {
		normalized := filepath.FromSlash(strings.ReplaceAll(fullPath, "\\", "/"))
		if _, err := os.Stat(normalized); err == nil {
			return true
		}
	}
	return false
}

// ReadTranscript reads and parses a session JSONL file
func ReadTranscript(projectID, sessionID string) ([]TranscriptMessage, error) {
	projectDir := filepath.Join(claudeDir(), "projects", projectID)

	// Try direct path first
	jsonlPath := filepath.Join(projectDir, sessionID+".jsonl")
	if _, err := os.Stat(jsonlPath); os.IsNotExist(err) {
		// Look it up from sessions-index
		idx, err := readSessionsIndex(projectDir)
		if err != nil {
			return nil, err
		}
		for _, s := range idx.Entries {
			if s.SessionID == sessionID && s.FullPath != "" {
				// Convert Windows path separators
				jsonlPath = filepath.FromSlash(strings.ReplaceAll(s.FullPath, "\\", "/"))
				break
			}
		}
	}

	f, err := os.Open(jsonlPath)
	if err != nil {
		return nil, fmt.Errorf("opening transcript: %w", err)
	}
	defer f.Close()

	var messages []TranscriptMessage
	scanner := bufio.NewScanner(f)
	// Increase buffer for large lines
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var msg TranscriptMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			continue // skip malformed lines
		}
		// Include user/assistant/result messages (tool_results arrive as type "user" or "result")
		if msg.Type == "user" || msg.Type == "assistant" || msg.Type == "result" {
			messages = append(messages, msg)
		}
	}
	return messages, scanner.Err()
}

// ReadSkills reads all skills from ~/.claude/skills/
func ReadSkills() ([]Skill, error) {
	skillsDir := filepath.Join(claudeDir(), "skills")
	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var skills []Skill
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillPath := filepath.Join(skillsDir, entry.Name(), "SKILL.md")
		skill, err := parseSkillFile(skillPath)
		if err != nil {
			continue
		}
		skills = append(skills, *skill)
	}
	return skills, nil
}

// parseSkillFile parses a SKILL.md with YAML frontmatter
func parseSkillFile(path string) (*Skill, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	content := string(data)
	skill := &Skill{FilePath: path}

	// Parse YAML frontmatter between --- delimiters
	if strings.HasPrefix(content, "---\n") {
		end := strings.Index(content[4:], "\n---")
		if end >= 0 {
			frontmatter := content[4 : 4+end]
			skill.Body = strings.TrimSpace(content[4+end+4:])

			// Simple YAML parsing (no dependency needed)
			for _, line := range strings.Split(frontmatter, "\n") {
				line = strings.TrimSpace(line)
				if k, v, ok := strings.Cut(line, ":"); ok {
					k = strings.TrimSpace(k)
					v = strings.TrimSpace(v)
					switch k {
					case "name":
						skill.Name = v
					case "description":
						skill.Description = v
					case "trigger":
						skill.Trigger = v
					}
				}
				// Parse match_tools array (simple inline)
				if strings.HasPrefix(line, "- ") && skill.Trigger != "" {
					skill.MatchTools = append(skill.MatchTools, strings.TrimPrefix(line, "- "))
				}
			}
		}
	}

	if skill.Name == "" {
		skill.Name = filepath.Base(filepath.Dir(path))
	}
	return skill, nil
}

// ReadConfig reads hooks, settings, and plugins
func ReadConfig() (*Config, error) {
	cfg := &Config{}

	// Read settings.json
	settingsPath := filepath.Join(claudeDir(), "settings.json")
	if data, err := os.ReadFile(settingsPath); err == nil {
		var settings map[string]interface{}
		if json.Unmarshal(data, &settings) == nil {
			cfg.Settings = settings

			// Extract hooks
			if hooksRaw, ok := settings["hooks"]; ok {
				cfg.Hooks = parseHooks(hooksRaw)
			}

			// Extract permissions
			if perms, ok := settings["permissions"]; ok {
				if permsMap, ok := perms.(map[string]interface{}); ok {
					cfg.Permissions = permsMap
				}
			}
		}
	}

	// Read installed_plugins.json
	pluginsPath := filepath.Join(claudeDir(), "plugins", "installed_plugins.json")
	if data, err := os.ReadFile(pluginsPath); err == nil {
		var pluginFile struct {
			Version int                          `json:"version"`
			Plugins map[string]json.RawMessage   `json:"plugins"`
		}
		if json.Unmarshal(data, &pluginFile) == nil {
			for name, raw := range pluginFile.Plugins {
				var installs []PluginInstall
				json.Unmarshal(raw, &installs)
				cfg.Plugins = append(cfg.Plugins, Plugin{
					Name:     name,
					Installs: installs,
				})
			}
		}
	}

	// Read skills
	skills, _ := ReadSkills()
	cfg.Skills = skills

	return cfg, nil
}

// parseHooks converts the raw hooks map into typed Hook structs
func parseHooks(raw interface{}) []Hook {
	hooksMap, ok := raw.(map[string]interface{})
	if !ok {
		return nil
	}

	var hooks []Hook
	for event, matchersRaw := range hooksMap {
		matchers, ok := matchersRaw.([]interface{})
		if !ok {
			continue
		}
		for _, m := range matchers {
			mMap, ok := m.(map[string]interface{})
			if !ok {
				continue
			}
			h := Hook{Event: event}
			if matcher, ok := mMap["matcher"].(string); ok {
				h.Matcher = matcher
			}
			if hooksList, ok := mMap["hooks"].([]interface{}); ok {
				for _, hk := range hooksList {
					hkMap, ok := hk.(map[string]interface{})
					if !ok {
						continue
					}
					def := HookDef{}
					if t, ok := hkMap["type"].(string); ok {
						def.Type = t
					}
					if p, ok := hkMap["prompt"].(string); ok {
						def.Prompt = p
					}
					if c, ok := hkMap["command"].(string); ok {
						def.Command = c
					}
					if t, ok := hkMap["timeout"].(float64); ok {
						def.Timeout = int(t)
					}
					h.Hooks = append(h.Hooks, def)
				}
			}
			hooks = append(hooks, h)
		}
	}
	return hooks
}
