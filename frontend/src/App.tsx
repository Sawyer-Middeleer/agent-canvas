import { useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas } from './Canvas';
import { DetailPane } from './components/DetailPane';
import { ProjectContextBar } from './components/ProjectContextBar';
import { useProjects, useSessions, useSkills, useConfig } from './hooks/useAPI';
import type { Session } from './types';
import './App.css';

function App() {
  const { projects, loading, error } = useProjects();
  const skills = useSkills();
  const config = useConfig();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<{ session: Session; projectId: string } | null>(null);
  const [hideCleanedUp, setHideCleanedUp] = useState(true);

  // Auto-select first project once loaded
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const { sessions: rawSessions, loading: sessionsLoading } = useSessions(selectedProjectId);

  const sessions = useMemo(() => {
    if (!hideCleanedUp) return rawSessions;
    return rawSessions.filter(s => s.hasTranscript);
  }, [rawSessions, hideCleanedUp]);

  const handleSelectSession = useCallback((session: Session, projectId: string) => {
    setSelectedSession(prev =>
      prev?.session.sessionId === session.sessionId ? null : { session, projectId }
    );
  }, []);

  // Clear selection when switching projects
  useEffect(() => {
    setSelectedSession(null);
  }, [selectedProjectId]);

  if (loading || (projects.length > 0 && !selectedProjectId)) {
    return (
      <div className="loading-screen">
        <div className="loading-text">Loading Claude Code state...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-screen">
        <div className="error-text">
          Failed to connect to gateway: {error}
          <br />
          <small>Make sure the Go backend is running on :3333</small>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="loading-screen">
        <div className="loading-text">No Claude Code projects found.</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="topbar-title">Agent Canvas</span>

        <select
          className="project-select"
          value={selectedProjectId || ''}
          onChange={e => setSelectedProjectId(e.target.value)}
        >
          {projects.map(p => {
            const name = p.path.split('\\').pop() || p.id;
            return (
              <option key={p.id} value={p.id}>
                {name} ({p.sessionCount} sessions)
              </option>
            );
          })}
        </select>

        <label className="topbar-toggle">
          <input
            type="checkbox"
            checked={hideCleanedUp}
            onChange={e => setHideCleanedUp(e.target.checked)}
          />
          <span>With transcript only</span>
        </label>

        <span className="topbar-info">
          {sessions.length} sessions{sessionsLoading ? ' ...' : ''}
        </span>
      </div>

      <ProjectContextBar skills={skills} config={config} />

      <div className={`canvas-container${selectedSession ? ' pane-open' : ''}`}>
        <Canvas
          sessions={sessions}
          projectId={selectedProjectId!}
          onSelectSession={handleSelectSession}
          selectedSessionId={selectedSession?.session.sessionId ?? null}
        />
      </div>

      {selectedSession && (
        <DetailPane
          session={selectedSession.session}
          projectId={selectedSession.projectId}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}

export default App;
