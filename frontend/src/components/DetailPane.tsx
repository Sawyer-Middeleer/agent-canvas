import { useState, useEffect, useRef } from 'react';
import type { Session, TranscriptMessage } from '../types';
import { fetchTranscript } from '../hooks/useAPI';
import { renderMessage } from './MessageRenderer';

interface Props {
  session: Session;
  projectId: string;
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function DetailPane({ session, projectId, onClose }: Props) {
  const [transcript, setTranscript] = useState<TranscriptMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session.hasTranscript) {
      setTranscript([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setTranscript(null);
    fetchTranscript(projectId, session.sessionId)
      .then(msgs => setTranscript(msgs))
      .catch(() => setTranscript([]))
      .finally(() => setLoading(false));
  }, [projectId, session.sessionId, session.hasTranscript]);

  // Auto-scroll to bottom when transcript loads or updates
  useEffect(() => {
    if (transcript && transcriptRef.current) {
      requestAnimationFrame(() => {
        transcriptRef.current!.scrollTop = transcriptRef.current!.scrollHeight;
      });
    }
  }, [transcript]);

  // Poll for updates if session is active
  useEffect(() => {
    if (!session.isActive || !session.hasTranscript) return;
    const interval = setInterval(() => {
      fetchTranscript(projectId, session.sessionId)
        .then(msgs => setTranscript(msgs))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [session.isActive, session.hasTranscript, projectId, session.sessionId]);

  return (
    <>
      <div className="detail-backdrop" onClick={onClose} />
      <div className="detail-pane">
        <button className="detail-close" onClick={onClose}>&times;</button>

        <div className="detail-header">
          <div className="detail-summary">
            {session.isActive && <span className="active-dot" />}
            {session.summary || 'Untitled'}
          </div>
          <div className="detail-meta">
            {session.isActive && <span className="badge live">LIVE</span>}
            <span className="badge">{session.gitBranch}</span>
            <span className="badge">{session.messageCount} msgs</span>
          </div>
          <div className="detail-path">{session.projectPath}</div>
          <div className="detail-dates">
            <span>Created: {formatDate(session.created)}</span>
            <span>Modified: {formatDate(session.modified)}</span>
          </div>
          {session.isActive && session.filesTouched && session.filesTouched.length > 0 && (
            <div className="detail-files-touched">
              <span className="detail-files-label">Files touched:</span>
              {session.filesTouched.map(f => (
                <span key={f} className="file-pill">{f}</span>
              ))}
            </div>
          )}
        </div>

        <div className="detail-transcript" ref={transcriptRef}>
          {loading && <div className="loading">Loading transcript...</div>}
          {transcript?.map((msg, i) => renderMessage(msg, i))}
          {transcript?.length === 0 && !loading && (
            <div className="empty">
              {session.hasTranscript
                ? 'No transcript available'
                : 'Transcript file has been cleaned up by Claude Code'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
