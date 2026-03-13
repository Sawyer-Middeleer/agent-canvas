import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSessionWS } from '../hooks/useSession';
import { renderMessage } from './MessageRenderer';
import type { TranscriptMessage, ContentBlock } from '../types';

export interface ChatSession {
  sessionId: string;
  projectId: string;
  isNew: boolean;
}

export function ChatPane({
  session,
  onClose,
  skipPermissions,
}: {
  session: ChatSession;
  onClose: () => void;
  skipPermissions?: boolean;
}) {
  const { events, partialBlocks, status, send } = useSessionWS(session.projectId, session.sessionId);
  const [input, setInput] = useState('');
  const [userPrompts, setUserPrompts] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sentFirst = useRef(false);

  // Convert streaming events + local user prompts into TranscriptMessage[]
  // so we can reuse renderMessage from the shared renderer.
  const messages = useMemo(() => {
    const msgs: TranscriptMessage[] = [];
    let promptIdx = 0;

    for (const evt of events) {
      if (evt.type === 'assistant' && evt.message) {
        // Insert queued user prompt before first assistant response
        if (promptIdx < userPrompts.length && (msgs.length === 0 || msgs[msgs.length - 1]?.message?.role !== 'user')) {
          msgs.push({
            type: 'user',
            uuid: `user-${promptIdx}`,
            parentUuid: null,
            timestamp: new Date().toISOString(),
            message: { role: 'user', content: userPrompts[promptIdx] },
          });
          promptIdx++;
        }

        const m = evt.message as { role: string; content: ContentBlock[] };
        msgs.push({
          type: 'assistant',
          uuid: `assistant-${msgs.length}`,
          parentUuid: null,
          timestamp: new Date().toISOString(),
          message: { role: m.role, content: m.content },
        });
      } else if (evt.type === 'result' && evt.is_error && Array.isArray(evt.errors)) {
        const errorText = (evt.errors as string[]).join('\n');
        msgs.push({
          type: 'assistant',
          uuid: `error-${msgs.length}`,
          parentUuid: null,
          timestamp: new Date().toISOString(),
          message: { role: 'assistant', content: [{ type: 'text', text: `Error: ${errorText}` }] },
        });
      } else if (evt.type === 'result') {
        // Turn boundary — next user prompt can attach
      }
    }

    // Any remaining user prompts not yet paired with a response
    while (promptIdx < userPrompts.length) {
      msgs.push({
        type: 'user',
        uuid: `user-${promptIdx}`,
        parentUuid: null,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: userPrompts[promptIdx] },
      });
      promptIdx++;
    }

    return msgs;
  }, [events, userPrompts]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, events, partialBlocks]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || status === 'running') return;

    setUserPrompts(prev => [...prev, text]);
    setInput('');

    if (!sentFirst.current && session.isNew) {
      send(text, 'create', skipPermissions);
    } else {
      send(text, undefined, skipPermissions);
    }
    sentFirst.current = true;
  }, [input, status, session.isNew, send, skipPermissions]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const statusColor = status === 'running' ? 'var(--green)' : status === 'error' ? 'var(--red)' : 'var(--text-dim)';

  return (
      <div className="chat-pane">
        <button className="detail-close" onClick={onClose}>&times;</button>

        <div className="chat-header">
          <span className="status-dot" style={{ background: statusColor }} />
          <span className="chat-session-id">{session.sessionId.slice(0, 8)}...</span>
          <span className="chat-status">{status}</span>
        </div>

        <div className="detail-transcript" ref={scrollRef}>
          {messages.length === 0 && status !== 'running' && (
            <div className="empty">Send a message to start the session.</div>
          )}
          {messages.map((msg, i) => renderMessage(msg, i))}
          {partialBlocks.length > 0 && (
            <div className="detail-msg assistant">
              <div className="detail-msg-role">claude</div>
              <div className="detail-msg-content">
                {partialBlocks.map(b => (
                  b.type === 'thinking' ? (
                    <div key={b.index} className="chat-typing">{b.thinking ? `thinking: ${b.thinking.slice(-200)}` : 'thinking...'}</div>
                  ) : b.type === 'text' ? (
                    <div key={b.index} className="block-text">{b.text}</div>
                  ) : b.type === 'tool_use' ? (
                    <div key={b.index} className="block-tool-use"><strong>{b.name}</strong></div>
                  ) : null
                ))}
              </div>
            </div>
          )}
          {status === 'running' && partialBlocks.length === 0 && messages[messages.length - 1]?.message?.role !== 'assistant' && (
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
            placeholder="Send a message..."
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
