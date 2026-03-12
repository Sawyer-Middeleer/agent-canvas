import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Session, TranscriptMessage, ContentBlock } from '../types';
import { fetchTranscript } from '../hooks/useAPI';
import { useSessionWS } from '../hooks/useSession';
import { renderMessage } from './MessageRenderer';

interface Props {
  session: Session;
  projectId: string;
  onClose: () => void;
  onArchive?: () => void;
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

export function DetailPane({ session, projectId, onClose, onArchive }: Props) {
  const [transcript, setTranscript] = useState<TranscriptMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');

  // WS hook for resuming the session
  const { events, status, send } = useSessionWS(projectId, session.sessionId);
  const [userPrompts, setUserPrompts] = useState<string[]>([]);

  // Fetch existing transcript
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

  // Convert WS streaming events into TranscriptMessages (same as ChatPane)
  const streamMessages = useMemo(() => {
    const msgs: TranscriptMessage[] = [];
    let promptIdx = 0;

    for (const evt of events) {
      if (evt.type === 'assistant' && evt.message) {
        if (promptIdx < userPrompts.length && (msgs.length === 0 || msgs[msgs.length - 1]?.message?.role !== 'user')) {
          msgs.push({
            type: 'user',
            uuid: `ws-user-${promptIdx}`,
            parentUuid: null,
            timestamp: new Date().toISOString(),
            message: { role: 'user', content: userPrompts[promptIdx] },
          });
          promptIdx++;
        }

        const m = evt.message as { role: string; content: ContentBlock[] };
        msgs.push({
          type: 'assistant',
          uuid: `ws-assistant-${msgs.length}`,
          parentUuid: null,
          timestamp: new Date().toISOString(),
          message: { role: m.role, content: m.content },
        });
      }
    }

    while (promptIdx < userPrompts.length) {
      msgs.push({
        type: 'user',
        uuid: `ws-user-${promptIdx}`,
        parentUuid: null,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: userPrompts[promptIdx] },
      });
      promptIdx++;
    }

    return msgs;
  }, [events, userPrompts]);

  // Combined: existing transcript + new streamed messages
  const allMessages = useMemo(() => {
    const existing = transcript || [];
    return [...existing, ...streamMessages];
  }, [transcript, streamMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (transcriptRef.current) {
      requestAnimationFrame(() => {
        transcriptRef.current!.scrollTop = transcriptRef.current!.scrollHeight;
      });
    }
  }, [allMessages]);

  // Poll for updates if session is active (and we haven't started our own WS session)
  useEffect(() => {
    if (!session.isActive || !session.hasTranscript || events.length > 0) return;
    const interval = setInterval(() => {
      fetchTranscript(projectId, session.sessionId)
        .then(msgs => setTranscript(msgs))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [session.isActive, session.hasTranscript, projectId, session.sessionId, events.length]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || status === 'running') return;

    setUserPrompts(prev => [...prev, text]);
    setInput('');
    send(text); // always resume for existing sessions
  }, [input, status, send]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
      <div className="detail-pane">
        <div className="detail-actions">
          {onArchive && (
            <button className="archive-btn-detail" title="Archive session" onClick={onArchive}>Archive</button>
          )}
          <button className="detail-close" onClick={onClose}>&times;</button>
        </div>

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
          {session.cronJobs && session.cronJobs.length > 0 && (
            <div className="detail-cron-jobs">
              <span className="detail-files-label">Scheduled jobs:</span>
              {session.cronJobs.map(job => (
                <div key={job.id} className="detail-cron-item">
                  <span className="cron-expr">{job.cron}</span>
                  {job.recurring && <span className="badge cron">recurring</span>}
                  <span className="cron-prompt">{job.prompt.length > 80 ? job.prompt.slice(0, 80) + '...' : job.prompt}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="detail-transcript" ref={transcriptRef}>
          {loading && <div className="loading">Loading transcript...</div>}
          {allMessages.map((msg, i) => renderMessage(msg, i))}
          {allMessages.length === 0 && !loading && (
            <div className="empty">
              {session.hasTranscript
                ? 'No transcript available'
                : 'Transcript file has been cleaned up by Claude Code'}
            </div>
          )}
          {status === 'running' && streamMessages[streamMessages.length - 1]?.message?.role !== 'assistant' && (
            <div className="detail-msg assistant">
              <div className="detail-msg-role">claude</div>
              <div className="detail-msg-content">
                <div className="chat-typing">thinking...</div>
              </div>
            </div>
          )}
        </div>

        <div className="chat-input-bar">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Resume session..."
            rows={2}
            disabled={status === 'running'}
          />
          <button
            className="chat-send"
            onClick={handleSend}
            disabled={status === 'running' || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
  );
}
