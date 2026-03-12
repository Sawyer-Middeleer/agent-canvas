import { useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas } from './Canvas';
import { DetailPane } from './components/DetailPane';
import { ChatPane } from './components/ChatPane';
import type { ChatSession } from './components/ChatPane';
import { ProjectContextBar } from './components/ProjectContextBar';
import { FileTreeSidebar } from './components/FileTreeSidebar';
import { useProjects, useSessions, useSkills, useConfig, useFileTree, archiveSession } from './hooks/useAPI';
import type { Session } from './types';
import './App.css';

function App() {
  const { projects, loading, error } = useProjects();
  const skills = useSkills();
  const config = useConfig();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    return localStorage.getItem('selectedProjectId');
  });
  const [selectedSession, setSelectedSession] = useState<{ session: Session; projectId: string } | null>(null);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [hideCleanedUp, setHideCleanedUp] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Auto-select first project once loaded, or validate stored selection
  useEffect(() => {
    if (projects.length === 0) return;
    if (selectedProjectId && projects.some(p => p.id === selectedProjectId)) return;
    setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  // Persist selected project to localStorage
  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem('selectedProjectId', selectedProjectId);
    }
  }, [selectedProjectId]);

  const { tree: fileTree, loading: fileTreeLoading } = useFileTree(selectedProjectId);
  const { sessions: rawSessions, loading: sessionsLoading, refresh: refreshSessions } = useSessions(selectedProjectId);

  const sessions = useMemo(() => {
    if (!hideCleanedUp) return rawSessions;
    return rawSessions.filter(s => s.hasTranscript);
  }, [rawSessions, hideCleanedUp]);

  const [showOlder, setShowOlder] = useState(false);

  const { recentSessions, olderSessions } = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent: Session[] = [];
    const older: Session[] = [];
    for (const s of sessions) {
      const t = new Date(s.modified).getTime();
      if (t >= cutoff || s.isActive) {
        recent.push(s);
      } else {
        older.push(s);
      }
    }
    return { recentSessions: recent, olderSessions: older };
  }, [sessions]);

  const handleSelectSession = useCallback((session: Session, projectId: string) => {
    setChatSession(null); // close chat when opening detail
    setSelectedSession(prev =>
      prev?.session.sessionId === session.sessionId ? null : { session, projectId }
    );
  }, []);

  const handleNewSession = useCallback(() => {
    if (!selectedProjectId) return;
    setSelectedSession(null); // close detail when opening chat
    setChatSession({
      sessionId: crypto.randomUUID(),
      projectId: selectedProjectId,
      isNew: true,
    });
  }, [selectedProjectId]);

  const handleArchiveSession = useCallback((sessionId: string) => {
    if (!selectedProjectId) return;
    archiveSession(selectedProjectId, sessionId).then(() => {
      if (selectedSession?.session.sessionId === sessionId) setSelectedSession(null);
      refreshSessions();
    }).catch(() => {});
  }, [selectedProjectId, selectedSession, refreshSessions]);

  // Clear selection when switching projects
  useEffect(() => {
    setSelectedSession(null);
    setChatSession(null);
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

        <button className="new-session-btn" onClick={handleNewSession}>
          + New Session
        </button>

        <button
          className="theme-toggle"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '\u2600' : '\u263D'}
        </button>

        <span className="topbar-info">
          {recentSessions.length} recent{olderSessions.length > 0 ? ` + ${olderSessions.length} older` : ''}{sessionsLoading ? ' ...' : ''}
        </span>
      </div>

      <ProjectContextBar skills={skills} config={config} />

      <div className="main-area">
        <FileTreeSidebar tree={fileTree} loading={fileTreeLoading} />

        <div className="canvas-container">
          <Canvas
            sessions={recentSessions}
            olderSessions={olderSessions}
            showOlder={showOlder}
            onToggleOlder={() => setShowOlder(v => !v)}
            projectId={selectedProjectId!}
            onSelectSession={handleSelectSession}
            selectedSessionId={selectedSession?.session.sessionId ?? null}
          />
        </div>

        <div className="right-sidebar">
          {selectedSession ? (
            <DetailPane
              session={selectedSession.session}
              projectId={selectedSession.projectId}
              onClose={() => setSelectedSession(null)}
              onArchive={() => handleArchiveSession(selectedSession.session.sessionId)}
            />
          ) : chatSession ? (
            <ChatPane
              session={chatSession}
              onClose={() => setChatSession(null)}
            />
          ) : (
            <div className="right-sidebar-empty">
              <div className="right-sidebar-empty-text">Select a session to view details</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
