package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3333"
	}

	mux := http.NewServeMux()

	// API routes
	setupAPI(mux)

	// WebSocket routes
	setupWS(mux)

	// Serve frontend static files
	frontendDist := filepath.Join("..", "frontend", "dist")
	if _, err := os.Stat(frontendDist); err == nil {
		fs := http.FileServer(http.Dir(frontendDist))
		mux.Handle("/", fs)
	} else {
		// Dev mode: just serve a placeholder
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, `<!DOCTYPE html><html><body>
				<h1>Agent Canvas</h1>
				<p>Frontend not built yet. Run <code>cd frontend && npm run build</code></p>
				<p>API available at <a href="/api/projects">/api/projects</a></p>
			</body></html>`)
		})
	}

	// CORS middleware for dev
	handler := corsMiddleware(mux)

	log.Printf("Agent Canvas gateway listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
