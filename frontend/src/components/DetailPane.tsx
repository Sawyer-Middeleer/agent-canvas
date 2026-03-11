import { useState, useEffect } from 'react';
import type { Session, TranscriptMessage, ContentBlock } from '../types';
import { fetchTranscript } from '../hooks/useAPI';

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

function CollapsibleBlock({ label, children, dimmed }: { label: string; children: React.ReactNode; dimmed?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`collapsible-block ${dimmed ? 'dimmed' : ''}`}>
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span className="collapsible-arrow">{open ? '\u25BC' : '\u25B6'}</span>
        <span>{label}</span>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

function TruncatedText({ text, limit = 500 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= limit) return <span>{text}</span>;
  return (
    <span>
      {expanded ? text : text.slice(0, limit) + '...'}
      <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'less' : 'more'}
      </button>
    </span>
  );
}

function renderBlock(block: ContentBlock, idx: number) {
  switch (block.type) {
    case 'text':
      return (
        <div key={idx} className="msg-block text">
          <pre className="msg-pre">{block.text}</pre>
        </div>
      );
    case 'thinking':
      return (
        <CollapsibleBlock key={idx} label="Thinking" dimmed>
          <pre className="msg-pre">{block.thinking}</pre>
        </CollapsibleBlock>
      );
    case 'tool_use':
      return (
        <div key={idx} className="msg-block tool-use">
          <span className="badge tool">{block.name}</span>
          <CollapsibleBlock label="Input">
            <pre className="msg-pre">{JSON.stringify(block.input, null, 2)}</pre>
          </CollapsibleBlock>
        </div>
      );
    case 'tool_result': {
      const text = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
          : '';
      return (
        <CollapsibleBlock key={idx} label="Tool Result">
          <pre className="msg-pre"><TruncatedText text={text} /></pre>
        </CollapsibleBlock>
      );
    }
    default:
      return null;
  }
}

function renderMessage(msg: TranscriptMessage, idx: number) {
  const role = msg.message?.role;
  const content = msg.message?.content;
  if (!content) return null;

  const blocks = typeof content === 'string'
    ? [{ type: 'text', text: content } as ContentBlock]
    : content;

  return (
    <div key={msg.uuid || idx} className={`detail-msg ${role || msg.type}`}>
      <div className="detail-msg-role">{role === 'user' ? '>' : 'claude'}</div>
      <div className="detail-msg-content">
        {blocks.map((block, bi) => renderBlock(block, bi))}
      </div>
    </div>
  );
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
    <>
      <div className="detail-backdrop" onClick={onClose} />
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
    </>
  );
}
