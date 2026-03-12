package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// fileTouchCache caches filesTouched per session to avoid re-scanning JSONL on every poll.
var (
	fileTouchCache   = map[string]fileTouchEntry{}
	fileTouchCacheMu sync.Mutex
)

type fileTouchEntry struct {
	modTime      time.Time
	filesTouched []string
}

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

// resolveProjectPath gets the real filesystem path for a project by peeking
// at the cwd field in JSONL transcript system messages. Falls back to
// decodeProjectPath if no transcripts are available.
func resolveProjectPath(projectID string) string {
	projectDir := filepath.Join(claudeDir(), "projects", projectID)
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return decodeProjectPath(projectID)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		if cwd := peekCWD(filepath.Join(projectDir, e.Name())); cwd != "" {
			return cwd
		}
	}
	return decodeProjectPath(projectID)
}

// peekCWD reads just the first few lines of a JSONL file to extract
// the cwd from the system init message.
func peekCWD(jsonlPath string) string {
	f, err := os.Open(jsonlPath)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1*1024*1024)

	for i := 0; i < 5 && scanner.Scan(); i++ {
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

// isWorktreeProject checks if a resolved project path is a .claude/worktrees/
// subdirectory of some other project. Returns the parent path if so.
func isWorktreeProject(resolvedPath string) (parentPath string, isWorktree bool) {
	// Look for \.claude\worktrees\ in the path
	marker := string(filepath.Separator) + ".claude" + string(filepath.Separator) + "worktrees" + string(filepath.Separator)
	idx := strings.Index(resolvedPath, marker)
	if idx < 0 {
		return "", false
	}
	return resolvedPath[:idx], true
}

// findWorktreeProjectIDs returns project directory names (IDs) that are
// worktrees belonging to the given parent project path.
func findWorktreeProjectIDs(parentPath string) []string {
	projectsDir := filepath.Join(claudeDir(), "projects")
	entries, _ := os.ReadDir(projectsDir)
	var ids []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		resolved := resolveProjectPath(e.Name())
		if parent, ok := isWorktreeProject(resolved); ok {
			if strings.EqualFold(filepath.Clean(parent), filepath.Clean(parentPath)) {
				ids = append(ids, e.Name())
			}
		}
	}
	return ids
}

// ReadProjects lists all projects from ~/.claude/projects/
// Worktree project directories are merged into their parent project.
func ReadProjects() ([]Project, error) {
	projectsDir := filepath.Join(claudeDir(), "projects")
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil, fmt.Errorf("reading projects dir: %w", err)
	}

	// First pass: resolve all paths and identify worktrees
	type projectInfo struct {
		name     string
		resolved string
		modTime  time.Time
	}
	var allProjects []projectInfo
	worktreeParent := map[string]string{} // worktree ID -> parent resolved path

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		resolved := resolveProjectPath(name)
		info, _ := entry.Info()
		mod := time.Time{}
		if info != nil {
			mod = info.ModTime()
		}
		allProjects = append(allProjects, projectInfo{name, resolved, mod})

		if parent, ok := isWorktreeProject(resolved); ok {
			worktreeParent[name] = parent
		}
	}

	// Second pass: build project list, skipping worktrees
	var projects []Project
	for _, p := range allProjects {
		if _, isWT := worktreeParent[p.name]; isWT {
			continue
		}

		// Count sessions (ReadSessions now includes worktree sessions)
		sessCount := 0
		if ss, err := ReadSessions(p.name); err == nil {
			sessCount = len(ss)
		}

		projects = append(projects, Project{
			ID:           p.name,
			Path:         p.resolved,
			EncodedName:  p.name,
			SessionCount: sessCount,
			LastModified: p.modTime,
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

// readSessionsFromDir reads sessions from a single project directory,
// merging sessions-index.json with orphan JSONL files.
func readSessionsFromDir(projectDir string) []Session {
	var sessions []Session
	indexed := map[string]bool{}
	idx, err := readSessionsIndex(projectDir)
	if err == nil {
		for i := range idx.Entries {
			s := &idx.Entries[i]
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
	return sessions
}

// ReadSessions returns sessions for a given project ID.
// It merges sessions from the main project dir and any worktree project dirs.
func ReadSessions(projectID string) ([]Session, error) {
	projectDir := filepath.Join(claudeDir(), "projects", projectID)

	// Collect sessions from the main project dir
	sessions := readSessionsFromDir(projectDir)
	seen := map[string]bool{}
	for _, s := range sessions {
		seen[s.SessionID] = true
	}

	// Also collect sessions from worktree project dirs
	parentPath := resolveProjectPath(projectID)
	for _, wtID := range findWorktreeProjectIDs(parentPath) {
		wtDir := filepath.Join(claudeDir(), "projects", wtID)
		for _, s := range readSessionsFromDir(wtDir) {
			if !seen[s.SessionID] {
				seen[s.SessionID] = true
				sessions = append(sessions, s)
			}
		}
	}

	// Backfill metadata for sessions that have transcripts but empty summaries
	for i := range sessions {
		s := &sessions[i]
		if s.HasTranscript && s.Summary == "" {
			fillSessionMetadata(s)
		}
	}

	// Enrich sessions with active status and activity data
	for i := range sessions {
		if sessions[i].HasTranscript {
			// Use the dir where the JSONL actually lives
			dir := projectDir
			if sessions[i].FullPath != "" {
				dir = filepath.Dir(filepath.FromSlash(strings.ReplaceAll(sessions[i].FullPath, "\\", "/")))
			}
			enrichActiveSession(&sessions[i], dir)
		}
	}

	if len(sessions) == 0 {
		return nil, fmt.Errorf("no sessions found")
	}
	return sessions, nil
}

// enrichActiveSession checks if a session is currently active by looking at
// ~/.claude/file-history/{sessionId}/ — this directory gets updated during
// tool execution (mid-response), unlike the JSONL which only updates after
// a complete response. Falls back to JSONL mod time as secondary signal.
func enrichActiveSession(s *Session, projectDir string) {
	// Primary signal: file-history directory recency
	fhDir := filepath.Join(claudeDir(), "file-history", s.SessionID)
	if entries, err := os.ReadDir(fhDir); err == nil {
		var newest time.Time
		for _, e := range entries {
			if info, err := e.Info(); err == nil && info.ModTime().After(newest) {
				newest = info.ModTime()
			}
		}
		if !newest.IsZero() && time.Since(newest) < 5*time.Minute {
			s.IsActive = true
		}
	}

	// Secondary signal: JSONL mod time
	if !s.IsActive {
		jsonlPath := filepath.Join(projectDir, s.SessionID+".jsonl")
		if _, err := os.Stat(jsonlPath); os.IsNotExist(err) && s.FullPath != "" {
			jsonlPath = filepath.FromSlash(strings.ReplaceAll(s.FullPath, "\\", "/"))
		}
		if info, err := os.Stat(jsonlPath); err == nil && time.Since(info.ModTime()) < 2*time.Minute {
			s.IsActive = true
		}
	}

	// Tail-scan the JSONL for filesTouched (cached for inactive sessions)
	jsonlPath := filepath.Join(projectDir, s.SessionID+".jsonl")
	if _, err := os.Stat(jsonlPath); os.IsNotExist(err) && s.FullPath != "" {
		jsonlPath = filepath.FromSlash(strings.ReplaceAll(s.FullPath, "\\", "/"))
	}
	info, err := os.Stat(jsonlPath)
	if err != nil {
		return
	}

	if s.IsActive {
		// Active sessions always get fresh data
		tailSessionActivity(s, jsonlPath, info.Size())
		// Update cache
		fileTouchCacheMu.Lock()
		fileTouchCache[s.SessionID] = fileTouchEntry{
			modTime:      info.ModTime(),
			filesTouched: s.FilesTouched,
		}
		fileTouchCacheMu.Unlock()
	} else {
		// Inactive sessions use cache; only re-scan if modtime changed
		fileTouchCacheMu.Lock()
		cached, ok := fileTouchCache[s.SessionID]
		fileTouchCacheMu.Unlock()

		if ok && cached.modTime.Equal(info.ModTime()) {
			s.FilesTouched = cached.filesTouched
		} else {
			tailSessionActivity(s, jsonlPath, info.Size())
			fileTouchCacheMu.Lock()
			fileTouchCache[s.SessionID] = fileTouchEntry{
				modTime:      info.ModTime(),
				filesTouched: s.FilesTouched,
			}
			fileTouchCacheMu.Unlock()
		}
	}
}

// tailSessionActivity reads the last chunk of a JSONL file to extract
// the most recent tool use and set of files touched.
func tailSessionActivity(s *Session, path string, size int64) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	// Read last 1MB
	chunkSize := int64(1024 * 1024)
	if chunkSize > size {
		chunkSize = size
	}

	buf := make([]byte, chunkSize)
	f.ReadAt(buf, size-chunkSize)

	// Split into lines, process from end
	lines := splitLines(buf)

	// Get project root for making paths relative
	projectRoot := s.ProjectPath
	if projectRoot == "" {
		projectRoot = peekCWD(path)
	}

	type toolBlock struct {
		Type  string                 `json:"type"`
		Name  string                 `json:"name,omitempty"`
		Input map[string]interface{} `json:"input,omitempty"`
	}

	filesTouched := map[string]bool{}
	foundLast := false

	for i := len(lines) - 1; i >= 0; i-- {
		line := lines[i]
		if len(line) == 0 {
			continue
		}

		var peek struct {
			Type    string `json:"type"`
			Message *struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(line, &peek) != nil || peek.Type != "assistant" || peek.Message == nil {
			continue
		}

		var blocks []toolBlock
		if json.Unmarshal(peek.Message.Content, &blocks) != nil {
			continue
		}

		for j := len(blocks) - 1; j >= 0; j-- {
			b := blocks[j]
			if b.Type != "tool_use" {
				continue
			}

			// Extract file path from tool input
			if fp, ok := b.Input["file_path"].(string); ok {
				display := fp
				if projectRoot != "" {
					if rel, err := filepath.Rel(projectRoot, fp); err == nil {
						display = filepath.ToSlash(rel)
					}
				}
				filesTouched[display] = true
				if !foundLast {
					s.LastToolUse = b.Name
					s.LastToolTarget = filepath.Base(fp)
					foundLast = true
				}
			} else if !foundLast {
				s.LastToolUse = b.Name
				if cmd, ok := b.Input["command"].(string); ok {
					if len(cmd) > 60 {
						s.LastToolTarget = cmd[:60]
					} else {
						s.LastToolTarget = cmd
					}
				} else if pat, ok := b.Input["pattern"].(string); ok {
					s.LastToolTarget = pat
				}
				foundLast = true
			}
		}

		// Stop after scanning enough messages
		if len(filesTouched) > 20 {
			break
		}
	}

	for f := range filesTouched {
		s.FilesTouched = append(s.FilesTouched, f)
	}
	sort.Strings(s.FilesTouched)
}

// splitLines splits a byte slice on newlines without allocating strings.
func splitLines(data []byte) [][]byte {
	var lines [][]byte
	for len(data) > 0 {
		idx := 0
		for idx < len(data) && data[idx] != '\n' {
			idx++
		}
		lines = append(lines, data[:idx])
		if idx < len(data) {
			data = data[idx+1:]
		} else {
			break
		}
	}
	return lines
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

// findTranscriptPath locates the JSONL file for a session, searching the main
// project dir and any worktree project dirs.
func findTranscriptPath(projectID, sessionID string) (string, error) {
	projectDir := filepath.Join(claudeDir(), "projects", projectID)

	// Try direct path
	jsonlPath := filepath.Join(projectDir, sessionID+".jsonl")
	if _, err := os.Stat(jsonlPath); err == nil {
		return jsonlPath, nil
	}

	// Try sessions-index in main dir
	if idx, err := readSessionsIndex(projectDir); err == nil {
		for _, s := range idx.Entries {
			if s.SessionID == sessionID && s.FullPath != "" {
				p := filepath.FromSlash(strings.ReplaceAll(s.FullPath, "\\", "/"))
				if _, err := os.Stat(p); err == nil {
					return p, nil
				}
			}
		}
	}

	// Search worktree project dirs
	parentPath := resolveProjectPath(projectID)
	for _, wtID := range findWorktreeProjectIDs(parentPath) {
		wtDir := filepath.Join(claudeDir(), "projects", wtID)
		p := filepath.Join(wtDir, sessionID+".jsonl")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		// Also check worktree's sessions-index
		if idx, err := readSessionsIndex(wtDir); err == nil {
			for _, s := range idx.Entries {
				if s.SessionID == sessionID && s.FullPath != "" {
					fp := filepath.FromSlash(strings.ReplaceAll(s.FullPath, "\\", "/"))
					if _, err := os.Stat(fp); err == nil {
						return fp, nil
					}
				}
			}
		}
	}

	return "", fmt.Errorf("transcript not found for session %s", sessionID)
}

// ReadTranscript reads and parses a session JSONL file
func ReadTranscript(projectID, sessionID string) ([]TranscriptMessage, error) {
	jsonlPath, err := findTranscriptPath(projectID, sessionID)
	if err != nil {
		return nil, err
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
			Version int                        `json:"version"`
			Plugins map[string]json.RawMessage `json:"plugins"`
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

// ReadFileTree walks the project directory and returns a tree of files/dirs.
// maxDepth caps recursion depth, maxEntries caps total entries for safety.
func ReadFileTree(projectPath string, maxDepth, maxEntries int) (*FileNode, error) {
	info, err := os.Stat(projectPath)
	if err != nil {
		return nil, fmt.Errorf("stat project path: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", projectPath)
	}

	skipDirs := map[string]bool{
		".git": true, "node_modules": true, "__pycache__": true,
		".next": true, "dist": true, "build": true, ".claude": true,
		".venv": true, "venv": true, ".idea": true, ".vscode": true,
	}

	count := 0
	var walk func(dir string, depth int) (*FileNode, error)
	walk = func(dir string, depth int) (*FileNode, error) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}

		node := &FileNode{
			Name:  filepath.Base(dir),
			Path:  dir,
			IsDir: true,
		}

		// Sort: dirs first, then alphabetical
		sort.Slice(entries, func(i, j int) bool {
			di, dj := entries[i].IsDir(), entries[j].IsDir()
			if di != dj {
				return di
			}
			return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
		})

		for _, e := range entries {
			if count >= maxEntries {
				break
			}
			name := e.Name()
			if e.IsDir() && skipDirs[name] {
				continue
			}
			count++
			childPath := filepath.Join(dir, name)

			if e.IsDir() && depth < maxDepth {
				child, err := walk(childPath, depth+1)
				if err != nil {
					continue
				}
				node.Children = append(node.Children, *child)
			} else {
				node.Children = append(node.Children, FileNode{
					Name:  name,
					Path:  childPath,
					IsDir: e.IsDir(),
				})
			}
		}
		return node, nil
	}

	return walk(projectPath, 1)
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
