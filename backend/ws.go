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
	"sync/atomic"

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
	// Generation counter: incremented each time a new process is spawned.
	// Goroutines from old processes check this before sending "done".
	var generation atomic.Int64

	// Resolved project path — set once on first prompt, reused for all subsequent prompts.
	var resolvedPath string

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

		// Build CLI args
		var args []string

		if resolvedPath == "" && msg.Action == "create" {
			// New session: resolve project path from the encoded project ID
			resolvedPath = resolveProjectPath(projectID)
			args = []string{
				"--session-id", sessionID,
				"-p", msg.Prompt,
				"--output-format", "stream-json",
				"--verbose",
				"--yes",
			}
			log.Printf("WS: creating new session %s in %s", sessionID, resolvedPath)
		} else {
			// Resume existing session
			if resolvedPath == "" {
				// First prompt but not "create" — find session in index
				sessions, err := ReadSessions(projectID)
				if err != nil {
					websocket.JSON.Send(ws, map[string]string{"error": "project not found: " + err.Error()})
					cmdMu.Unlock()
					return
				}
				for _, s := range sessions {
					if s.SessionID == sessionID {
						resolvedPath = s.ProjectPath
						break
					}
				}
				// ProjectPath may be empty in the index; fall back to resolving from JSONL
				if resolvedPath == "" {
					resolvedPath = resolveProjectPath(projectID)
				}
			}

			args = []string{
				"--resume", sessionID,
				"-p", msg.Prompt,
				"--output-format", "stream-json",
				"--verbose",
				"--yes",
			}
			log.Printf("WS: resuming session %s in %s", sessionID, resolvedPath)
		}

		gen := generation.Add(1)
		err := startAndStream(ctx, ws, &cmd, resolvedPath, args, &generation, gen)
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
// generation/myGen ensure that only the latest process sends "done" status.
func startAndStream(ctx context.Context, ws *websocket.Conn, cmd **exec.Cmd, dir string, args []string, generation *atomic.Int64, myGen int64) error {
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
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			log.Printf("WS stderr: %s", scanner.Text())
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024)
		eventCount := 0
		for scanner.Scan() {
			// Stop streaming if a newer process has taken over
			if generation.Load() != myGen {
				log.Printf("WS stream: generation %d superseded, stopping", myGen)
				break
			}
			line := scanner.Text()
			var event map[string]interface{}
			if json.Unmarshal([]byte(line), &event) == nil {
				eventCount++
				if t, ok := event["type"].(string); ok {
					log.Printf("WS stream: event #%d type=%s", eventCount, t)
				}
				event["source"] = "stream"
				websocket.JSON.Send(ws, event)
			}
		}
		exitErr := c.Wait()
		log.Printf("WS stream: process exited (events=%d, err=%v)", eventCount, exitErr)
		// Only send "done" if we're still the active generation
		if generation.Load() == myGen {
			websocket.JSON.Send(ws, map[string]string{"type": "status", "status": "done"})
		}
	}()

	return nil
}
