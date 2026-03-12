import { useState } from 'react';
import type { TranscriptMessage, ContentBlock } from '../types';

export function CollapsibleBlock({ label, children, dimmed }: { label: string; children: React.ReactNode; dimmed?: boolean }) {
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

export function TruncatedText({ text, limit = 500 }: { text: string; limit?: number }) {
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

export function renderBlock(block: ContentBlock, idx: number) {
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

export function renderMessage(msg: TranscriptMessage, idx: number) {
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
