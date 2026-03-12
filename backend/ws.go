package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"sync"

	"golang.org/x/net/websocket"
)

// setupWS registers WebSocket endpoints
func setupWS(mux *http.ServeMux) {
	mux.Handle("/ws/sessions/{projectID}/{sessionID}", websocket.Handler(handleSessionWS))
}

func handleSessionWS(ws *websocket.Conn) {
	r := ws.Request()
	projectID := r.PathValue("projectID")
	sessionID := r.PathValue("sessionID")

	if projectID == "" || sessionID == "" {
		websocket.JSON.Send(ws, map[string]string{"error": "projectID and sessionID required"})
		return
	}

	log.Printf("WS: session %s in project %s", sessionID, projectID)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Send initial status
	websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "starting"})

	var cmd *exec.Cmd
	var cmdMu sync.Mutex
	// Track whether the session has been created on disk yet (first prompt done)
	sessionStarted := false

	for {
		var msg struct {
			Type   string `json:"type"`
			Prompt string `json:"prompt"`
			Action string `json:"action"` // "create" or "resume" (default)
		}
		if err := websocket.JSON.Receive(ws, &msg); err != nil {
			log.Printf("WS read error: %v", err)
			cancel()
			break
		}

		if msg.Type != "prompt" || msg.Prompt == "" {
			continue
		}

		cmdMu.Lock()

		// Kill previous process if still running
		if cmd != nil && cmd.Process != nil {
			cmd.Process.Kill()
			cmd.Wait()
			cmd = nil
		}

		// Resolve project path and build CLI args
		var projectPath string
		var args []string

		if !sessionStarted && msg.Action == "create" {
			// New session: resolve project path from the encoded project ID
			projectPath = resolveProjectPath(projectID)
			args = []string{
				"--session-id", sessionID,
				"-p", msg.Prompt,
				"--output-format", "stream-json",
				"--verbose",
			}
			log.Printf("WS: creating new session %s in %s", sessionID, projectPath)
		} else {
			// Resume existing session: look up path from sessions index
			if !sessionStarted {
				// First prompt but not "create" — find session in index
				sessions, err := ReadSessions(projectID)
				if err != nil {
					websocket.JSON.Send(ws, map[string]string{"error": "project not found: " + err.Error()})
					cmdMu.Unlock()
					return
				}
				for _, s := range sessions {
					if s.SessionID == sessionID {
						projectPath = s.ProjectPath
						break
					}
				}
				if projectPath == "" {
					websocket.JSON.Send(ws, map[string]string{"error": "session not found"})
					cmdMu.Unlock()
					return
				}
			} else {
				// Subsequent prompt — always resume, reuse decoded path
				projectPath = decodeProjectPath(projectID)
			}

			args = []string{
				"--resume", sessionID,
				"-p", msg.Prompt,
				"--output-format", "stream-json",
				"--verbose",
			}
			log.Printf("WS: resuming session %s in %s", sessionID, projectPath)
		}

		err := startAndStream(ctx, ws, &cmd, projectPath, args)
		sessionStarted = true
		cmdMu.Unlock()

		if err != nil {
			websocket.JSON.Send(ws, map[string]string{"error": err.Error()})
			return
		}
	}

	// Cleanup
	cmdMu.Lock()
	if cmd != nil && cmd.Process != nil {
		cmd.Process.Kill()
	}
	cmdMu.Unlock()
}

// startAndStream spawns a claude CLI process and streams its stdout to the WebSocket.
// The caller must hold cmdMu. The cmd pointer is updated and cleared when the process exits.
func startAndStream(ctx context.Context, ws *websocket.Conn, cmd **exec.Cmd, dir string, args []string) error {
	c := exec.CommandContext(ctx, "claude", args...)
	c.Dir = dir
	*cmd = c

	stdout, err := c.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %v", err)
	}

	stderr, err := c.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %v", err)
	}

	if err := c.Start(); err != nil {
		return fmt.Errorf("start: %v", err)
	}

	websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "running"})

	// Log stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			log.Printf("WS stderr: %s", scanner.Text())
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			var event map[string]interface{}
			if json.Unmarshal([]byte(line), &event) == nil {
				event["source"] = "stream"
				websocket.JSON.Send(ws, event)
			}
		}
		c.Wait()
		websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "done"})
	}()

	return nil
}
