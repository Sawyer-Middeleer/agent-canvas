import { useState, useRef, useCallback } from 'react';
import { TransformWrapper, TransformComponent, useControls, useTransformContext } from 'react-zoom-pan-pinch';
import { SessionCard } from './components/SessionCard';
import type { Session } from './types';

interface Props {
  sessions: Session[];
  olderSessions?: Session[];
  showOlder?: boolean;
  onToggleOlder?: () => void;
  projectId: string;
  onSelectSession?: (session: Session, projectId: string) => void;
  selectedSessionId?: string | null;
}

const START_X = 40;
const START_Y = 40;
const ROW_HEIGHT = 130;
const OLDER_HEADER_HEIGHT = 44;

function layoutSessions(recent: Session[], older: Session[], showOlder: boolean) {
  const nodes: { id: string; x: number; y: number; session: Session }[] = [];

  recent.forEach((session, i) => {
    nodes.push({
      id: `sess-${session.sessionId}`,
      x: START_X,
      y: START_Y + i * ROW_HEIGHT,
      session,
    });
  });

  // The collapsible header sits after recent sessions
  const olderStartY = START_Y + recent.length * ROW_HEIGHT + OLDER_HEADER_HEIGHT;

  if (showOlder) {
    older.forEach((session, i) => {
      nodes.push({
        id: `sess-${session.sessionId}`,
        x: START_X,
        y: olderStartY + i * ROW_HEIGHT,
        session,
      });
    });
  }

  return nodes;
}

function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="zoom-controls">
      <button onClick={() => zoomIn()} title="Zoom in">+</button>
      <button onClick={() => zoomOut()} title="Zoom out">&minus;</button>
      <button onClick={() => resetTransform()} title="Reset view">fit</button>
    </div>
  );
}

function CanvasInner({ sessions, olderSessions = [], showOlder = false, onToggleOlder, projectId, onSelectSession, selectedSessionId }: Props) {
  const nodes = layoutSessions(sessions, olderSessions, showOlder);
  const [dragging, setDragging] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const dragStart = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);
  const ctx = useTransformContext();

  const maxX = Math.max(...nodes.map(n => (offsets[n.id]?.x ?? n.x) + 360), 800);
  const maxY = Math.max(...nodes.map(n => (offsets[n.id]?.y ?? n.y) + 200), 2000);

  const olderHeaderY = START_Y + sessions.length * ROW_HEIGHT;

  const onPointerDown = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const currentX = offsets[nodeId]?.x ?? node.x;
    const currentY = offsets[nodeId]?.y ?? node.y;
    dragStart.current = { x: e.clientX, y: e.clientY, nodeX: currentX, nodeY: currentY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    ctx.setup.disabled = true;
  }, [nodes, offsets, ctx]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffsets(prev => ({
      ...prev,
      [dragging]: {
        x: dragStart.current!.nodeX + dx,
        y: dragStart.current!.nodeY + dy,
      }
    }));
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    setDragging(null);
    dragStart.current = null;
    ctx.setup.disabled = false;
  }, [ctx]);

  return (
    <>
      <ZoomControls />
      <TransformComponent
        wrapperStyle={{ width: '100%', height: '100%', background: 'transparent' }}
        contentStyle={{ width: maxX + 400, height: maxY + 400 }}
      >
        <div
          className="canvas-world"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {nodes.map(node => {
            const x = offsets[node.id]?.x ?? node.x;
            const y = offsets[node.id]?.y ?? node.y;
            return (
              <div
                key={node.id}
                className="canvas-node"
                style={{ left: x, top: y }}
                onPointerDown={e => onPointerDown(node.id, e)}
              >
                <SessionCard
                  session={node.session}
                  projectId={projectId}
                  selected={selectedSessionId === node.session.sessionId}
                  onClick={() => onSelectSession?.(node.session, projectId)}
                />
              </div>
            );
          })}

          {olderSessions.length > 0 && (
            <div
              className="older-sessions-toggle"
              style={{ left: START_X, top: olderHeaderY }}
              onClick={onToggleOlder}
            >
              <span className="older-arrow">{showOlder ? '\u25BC' : '\u25B6'}</span>
              <span>Older sessions ({olderSessions.length})</span>
            </div>
          )}

          {sessions.length === 0 && olderSessions.length === 0 && (
            <div className="canvas-empty">No sessions to display</div>
          )}
        </div>
      </TransformComponent>
    </>
  );
}

export function Canvas(props: Props) {
  return (
    <TransformWrapper
      limitToBounds={false}
      minScale={0.1}
      maxScale={3}
      initialScale={0.85}
      initialPositionX={0}
      initialPositionY={0}
      panning={{ velocityDisabled: true }}
    >
      <CanvasInner {...props} />
    </TransformWrapper>
  );
}
