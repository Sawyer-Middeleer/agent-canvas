package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

func setupAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/projects", handleProjects)
	mux.HandleFunc("GET /api/projects/{id}/sessions", handleSessions)
	mux.HandleFunc("GET /api/sessions/{projectID}/{sessionID}/transcript", handleTranscript)
	mux.HandleFunc("POST /api/sessions/{projectID}/{sessionID}/archive", handleArchiveSession)
	mux.HandleFunc("GET /api/projects/{id}/filetree", handleFileTree)
	mux.HandleFunc("GET /api/projects/{id}/file", handleFileContent)
	mux.HandleFunc("GET /api/skills", handleSkills)
	mux.HandleFunc("GET /api/config", handleConfig)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func handleProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := ReadProjects()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, projects)
}

func handleSessions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, 400, "project id required")
		return
	}
	// Sanitize: only allow alphanumeric, dash, underscore
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			writeError(w, 400, "invalid project id")
			return
		}
	}
	sessions, err := ReadSessions(id)
	if err != nil {
		writeError(w, 404, "project not found: "+err.Error())
		return
	}
	writeJSON(w, sessions)
}

func handleTranscript(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("projectID")
	sessionID := r.PathValue("sessionID")
	if projectID == "" || sessionID == "" {
		writeError(w, 400, "projectID and sessionID required")
		return
	}
	// Sanitize IDs
	for _, id := range []string{projectID, sessionID} {
		for _, c := range id {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
				writeError(w, 400, "invalid id")
				return
			}
		}
	}

	messages, err := ReadTranscript(projectID, sessionID)
	if err != nil {
		if strings.Contains(err.Error(), "not exist") || strings.Contains(err.Error(), "no such file") {
			writeError(w, 404, "transcript not found")
		} else {
			writeError(w, 500, err.Error())
		}
		return
	}

	total := len(messages)
	w.Header().Set("X-Total-Count", strconv.Itoa(total))

	// Pagination: ?limit=N returns last N messages, ?offset=M skips M from the end
	limit := total
	offset := 0
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	if s := r.URL.Query().Get("offset"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			offset = n
		}
	}

	end := total - offset
	start := end - limit
	if start < 0 {
		start = 0
	}
	if end < 0 {
		end = 0
	}
	if end > total {
		end = total
	}

	writeJSON(w, messages[start:end])
}

func handleArchiveSession(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("projectID")
	sessionID := r.PathValue("sessionID")
	if projectID == "" || sessionID == "" {
		writeError(w, 400, "projectID and sessionID required")
		return
	}
	for _, id := range []string{projectID, sessionID} {
		for _, c := range id {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
				writeError(w, 400, "invalid id")
				return
			}
		}
	}
	if err := ArchiveSession(sessionID); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "archived"})
}

func handleFileTree(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, 400, "project id required")
		return
	}
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			writeError(w, 400, "invalid project id")
			return
		}
	}
	projectPath := resolveProjectPath(id)
	tree, err := ReadFileTree(projectPath, 4, 500)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, tree)
}

func handleFileContent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, 400, "project id required")
		return
	}
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			writeError(w, 400, "invalid project id")
			return
		}
	}
	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		writeError(w, 400, "path query parameter required")
		return
	}
	projectPath := resolveProjectPath(id)
	fc, err := ReadFileContent(projectPath, relPath)
	if err != nil {
		if strings.Contains(err.Error(), "outside project") {
			writeError(w, 403, err.Error())
		} else {
			writeError(w, 404, err.Error())
		}
		return
	}
	writeJSON(w, fc)
}

func handleSkills(w http.ResponseWriter, r *http.Request) {
	skills, err := ReadSkills()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if skills == nil {
		skills = []Skill{}
	}
	writeJSON(w, skills)
}

func handleConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := ReadConfig()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, cfg)
}
