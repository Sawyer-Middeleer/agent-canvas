import { useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas } from './Canvas';
import { DetailPane } from './components/DetailPane';
import { useProjects, useSkills, useConfig } from './hooks/useAPI';
import type { Session } from './types';
import './App.css';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3333' : '';

function App() {
  const { projects, loading, error } = useProjects();
  const skills = useSkills();
  const config = useConfig();
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string>('__all__');
  const [selectedSession, setSelectedSession] = useState<{ session: Session; projectId: string } | null>(null);
  const [hideCleanedUp, setHideCleanedUp] = useState(true);

  const handleSelectSession = useCallback((session: Session, projectId: string) => {
    setSelectedSession(prev =>
      prev?.session.sessionId === session.sessionId ? null : { session, projectId }
    );
  }, []);

  // Load sessions for all projects on mount
  useEffect(() => {
    projects.forEach(async (project) => {
      try {
        const res = await fetch(`${API_BASE}/api/projects/${project.id}/sessions`);
        if (res.ok) {
          const sessions: Session[] = await res.json();
          setSessionsByProject(prev => ({ ...prev, [project.id]: sessions }));
        }
      } catch {
        // ignore
      }
    });
  }, [projects]);

  // Filter projects based on dropdown
  const filteredProjects = useMemo(() => {
    if (selectedProjectId === '__all__') return projects;
    return projects.filter(p => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  const filteredSessions = useMemo(() => {
    const source = selectedProjectId === '__all__'
      ? sessionsByProject
      : { [selectedProjectId]: sessionsByProject[selectedProjectId] || [] };
    if (!hideCleanedUp) return source;
    const out: Record<string, Session[]> = {};
    for (const [pid, sessions] of Object.entries(source)) {
      const filtered = sessions.filter(s => s.hasTranscript);
      if (filtered.length > 0) out[pid] = filtered;
    }
    return out;
  }, [sessionsByProject, selectedProjectId, hideCleanedUp]);

  const totalSessions = Object.values(sessionsByProject).reduce((n, s) => n + s.length, 0);

  if (loading) {
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

  return (
    <div className="app">
      <div className="topbar">
        <span className="topbar-title">Agent Canvas</span>

        <select
          className="project-select"
          value={selectedProjectId}
          onChange={e => setSelectedProjectId(e.target.value)}
        >
          <option value="__all__">All projects ({projects.length})</option>
          {projects.map(p => {
            const name = p.path.split('\\').pop() || p.id;
            const count = sessionsByProject[p.id]?.length || 0;
            return (
              <option key={p.id} value={p.id}>
                {name} ({count} sessions)
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
          {totalSessions} sessions &middot; {skills.length} skills
        </span>
      </div>
      <div className={`canvas-container${selectedSession ? ' pane-open' : ''}`}>
        <Canvas
          projects={filteredProjects}
          sessionsByProject={filteredSessions}
          skills={skills}
          config={config}
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
