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

	log.Printf("WS: resuming session %s in project %s", sessionID, projectID)

	// Find the project path from sessions-index
	sessions, err := ReadSessions(projectID)
	if err != nil {
		websocket.JSON.Send(ws, map[string]string{"error": "project not found: " + err.Error()})
		return
	}

	var projectPath string
	for _, s := range sessions {
		if s.SessionID == sessionID {
			projectPath = s.ProjectPath
			break
		}
	}
	if projectPath == "" {
		websocket.JSON.Send(ws, map[string]string{"error": "session not found"})
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Send initial status
	websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "starting"})

	// We don't immediately spawn claude; we wait for the first user prompt
	var cmd *exec.Cmd
	var cmdMu sync.Mutex
	// Read user messages
	for {
		var msg struct {
			Type   string `json:"type"`
			Prompt string `json:"prompt"`
		}
		if err := websocket.JSON.Receive(ws, &msg); err != nil {
			log.Printf("WS read error: %v", err)
			cancel()
			break
		}

		if msg.Type == "prompt" && msg.Prompt != "" {
			cmdMu.Lock()
			if cmd == nil {
				// First prompt: spawn claude with --resume
				cmd = exec.CommandContext(ctx, "claude",
					"--resume", sessionID,
					"-p", msg.Prompt,
					"--output-format", "stream-json",
				)
				cmd.Dir = projectPath

				stdout, err := cmd.StdoutPipe()
				if err != nil {
					websocket.JSON.Send(ws, map[string]string{"error": fmt.Sprintf("stdout pipe: %v", err)})
					cmdMu.Unlock()
					return
				}

				if err := cmd.Start(); err != nil {
					websocket.JSON.Send(ws, map[string]string{"error": fmt.Sprintf("start: %v", err)})
					cmdMu.Unlock()
					return
				}

				websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "running"})

				// Stream stdout to WebSocket
				go func() {
					scanner := bufio.NewScanner(stdout)
					scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)
					for scanner.Scan() {
						line := scanner.Text()
						// Forward raw stream-json events
						var event map[string]interface{}
						if json.Unmarshal([]byte(line), &event) == nil {
							event["type"] = "stream"
							websocket.JSON.Send(ws, event)
						}
					}
					// Process done
					cmd.Wait()
					websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "done"})
					cmdMu.Lock()
					cmd = nil
					cmdMu.Unlock()
				}()
			} else {
				// Subsequent prompts — spawn new claude --resume with new prompt
				// Kill previous if still running
				if cmd.Process != nil {
					cmd.Process.Kill()
				}
				cmd = nil
				cmdMu.Unlock()

				// Re-enter the loop — next iteration will spawn fresh
				cmdMu.Lock()
				// Spawn new instance
				cmd = exec.CommandContext(ctx, "claude",
					"--resume", sessionID,
					"-p", msg.Prompt,
					"--output-format", "stream-json",
				)
				cmd.Dir = projectPath

				stdout, err := cmd.StdoutPipe()
				if err != nil {
					websocket.JSON.Send(ws, map[string]string{"error": fmt.Sprintf("stdout pipe: %v", err)})
					cmdMu.Unlock()
					return
				}

				if err := cmd.Start(); err != nil {
					websocket.JSON.Send(ws, map[string]string{"error": fmt.Sprintf("start: %v", err)})
					cmdMu.Unlock()
					return
				}

				websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "running"})

				go func() {
					scanner := bufio.NewScanner(stdout)
					scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)
					for scanner.Scan() {
						line := scanner.Text()
						var event map[string]interface{}
						if json.Unmarshal([]byte(line), &event) == nil {
							event["type"] = "stream"
							websocket.JSON.Send(ws, event)
						}
					}
					cmd.Wait()
					websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "done"})
					cmdMu.Lock()
					cmd = nil
					cmdMu.Unlock()
				}()
			}
			cmdMu.Unlock()
		}
	}

	// Cleanup
	cmdMu.Lock()
	if cmd != nil && cmd.Process != nil {
		cmd.Process.Kill()
	}
	cmdMu.Unlock()
}
