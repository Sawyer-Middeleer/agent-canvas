import { useState, useEffect } from 'react';
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

  return (
      <div className="detail-pane">
        <button className="detail-close" onClick={onClose}>&times;</button>

        <div className="detail-header">
          <div className="detail-summary">{session.summary || 'Untitled'}</div>
          <div className="detail-meta">
            <span className="badge">{session.gitBranch}</span>
            <span className="badge">{session.messageCount} msgs</span>
          </div>
          <div className="detail-path">{session.projectPath}</div>
          <div className="detail-dates">
            <span>Created: {formatDate(session.created)}</span>
            <span>Modified: {formatDate(session.modified)}</span>
          </div>
        </div>

        <div className="detail-transcript">
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
  );
}
