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

function formatActivity(tool: string, target?: string): string {
  const verbs: Record<string, string> = {
    Read: 'Reading', Edit: 'Editing', Write: 'Writing',
    Bash: 'Running', Grep: 'Searching', Glob: 'Finding',
    Agent: 'Agent', WebFetch: 'Fetching', WebSearch: 'Searching',
  };
  const verb = verbs[tool] || tool;
  return target ? `${verb} ${target}` : verb;
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
      className={`session-card${selected ? ' selected' : ''}${session.isActive ? ' active' : ''}`}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
    >
      <div className="session-header">
        <div className="session-summary">
          {session.isActive && <span className="active-dot" />}
          {session.summary || 'Untitled'}
        </div>
        <div className="session-meta">
          {session.isActive && <span className="badge live">LIVE</span>}
          <span className="badge">{session.gitBranch}</span>
          <span className="badge">{session.messageCount} msgs</span>
          <span className="session-date">{formatDate(session.modified)}</span>
        </div>
      </div>

      {session.isActive && session.lastToolUse && (
        <div className="session-activity">
          {formatActivity(session.lastToolUse, session.lastToolTarget)}
        </div>
      )}

      {session.isActive && session.filesTouched && session.filesTouched.length > 0 && (
        <div className="session-files">
          {session.filesTouched.slice(0, 6).map(f => (
            <span key={f} className="file-pill">{f}</span>
          ))}
          {session.filesTouched.length > 6 && (
            <span className="file-pill dim">+{session.filesTouched.length - 6}</span>
          )}
        </div>
      )}

      {session.firstPrompt && session.firstPrompt !== 'No prompt' && (
        <div className="session-prompt">
          {session.firstPrompt.slice(0, 120)}
          {session.firstPrompt.length > 120 ? '...' : ''}
        </div>
      )}
    </div>
  );
}
