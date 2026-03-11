import type { Session } from '../types';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

interface Props {
  session: Session;
  projectId: string;
  selected?: boolean;
  onClick?: () => void;
}

export function SessionCard({ session, selected, onClick }: Props) {
  return (
    <div
      className={`session-card${selected ? ' selected' : ''}`}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
    >
      <div className="session-header">
        <div className="session-summary">{session.summary || 'Untitled'}</div>
        <div className="session-meta">
          <span className="badge">{session.gitBranch}</span>
          <span className="badge">{session.messageCount} msgs</span>
          <span className="session-date">{formatDate(session.modified)}</span>
        </div>
      </div>

      {session.firstPrompt && session.firstPrompt !== 'No prompt' && (
        <div className="session-prompt">
          {session.firstPrompt.slice(0, 120)}
          {session.firstPrompt.length > 120 ? '...' : ''}
        </div>
      )}
    </div>
  );
}
