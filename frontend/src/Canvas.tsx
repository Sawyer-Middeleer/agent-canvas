import { useState, useRef, useCallback, useMemo } from 'react';
import { TransformWrapper, TransformComponent, useControls, useTransformContext } from 'react-zoom-pan-pinch';
import { SessionCard } from './components/SessionCard';
import { DirCard } from './components/FileCard';
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

// Layout constants
const SESSION_X = 60;
const DIR_START_X = 500;
const DIR_COL_GAP = 20;
const START_Y = 40;
const SESSION_HEIGHT = 110;
const SESSION_WIDTH = 320;
const SESSION_GAP = 20;
const DIR_WIDTH = 180;
const DIR_FILE_HEIGHT = 24;
const DIR_HEADER_HEIGHT = 28;
const DIR_GAP = 16;
const DIR_GRID_COLS = 3;
const OLDER_HEADER_HEIGHT = 44;

interface SessionNode {
  id: string;
  x: number;
  y: number;
  session: Session;
}

interface DirNode {
  id: string;
  dir: string;
  files: string[]; // basenames
  fullPaths: string[]; // relative paths (dir/file)
  x: number;
  y: number;
  height: number;
}

interface Edge {
  id: string;
  sessionId: string;
  dirId: string;
}

function splitPath(relPath: string): { dir: string; base: string } {
  const slash = relPath.lastIndexOf('/');
  if (slash < 0) return { dir: '.', base: relPath };
  return { dir: relPath.slice(0, slash), base: relPath.slice(slash + 1) };
}

function buildGraph(recent: Session[], older: Session[], showOlder: boolean) {
  const sessionNodes: SessionNode[] = [];
  const allSessions = [...recent];

  recent.forEach((session, i) => {
    sessionNodes.push({
      id: `sess-${session.sessionId}`,
      x: SESSION_X,
      y: START_Y + i * (SESSION_HEIGHT + SESSION_GAP),
      session,
    });
  });

  const olderStartY = START_Y + recent.length * (SESSION_HEIGHT + SESSION_GAP) + OLDER_HEADER_HEIGHT;

  if (showOlder) {
    older.forEach((session, i) => {
      sessionNodes.push({
        id: `sess-${session.sessionId}`,
        x: SESSION_X,
        y: olderStartY + i * (SESSION_HEIGHT + SESSION_GAP),
        session,
      });
      allSessions.push(session);
    });
  }

  // Group files by directory, track which sessions touch each directory
  const dirFiles = new Map<string, Set<string>>(); // dir -> Set<basename>
  const dirFullPaths = new Map<string, Set<string>>(); // dir -> Set<relPath>
  const dirToSessionIds = new Map<string, Set<string>>(); // dir -> Set<sessionNodeId>

  for (const s of allSessions) {
    if (!s.filesTouched?.length) continue;
    const sessNodeId = `sess-${s.sessionId}`;
    for (const relPath of s.filesTouched) {
      const { dir, base } = splitPath(relPath);

      if (!dirFiles.has(dir)) dirFiles.set(dir, new Set());
      dirFiles.get(dir)!.add(base);

      if (!dirFullPaths.has(dir)) dirFullPaths.set(dir, new Set());
      dirFullPaths.get(dir)!.add(relPath);

      if (!dirToSessionIds.has(dir)) dirToSessionIds.set(dir, new Set());
      dirToSessionIds.get(dir)!.add(sessNodeId);
    }
  }

  // Layout directory cards in a grid
  const sessionYMap = new Map(sessionNodes.map(n => [n.id, n.y]));
  const dirEntries = [...dirFiles.entries()]
    .map(([dir, fileSet]) => {
      const sessIds = [...(dirToSessionIds.get(dir) || [])];
      // Sort by average connected session Y
      const avgY = sessIds.reduce((sum, sid) => {
        return sum + (sessionYMap.get(sid) ?? 0) + SESSION_HEIGHT / 2;
      }, 0) / (sessIds.length || 1);
      return { dir, files: [...fileSet].sort(), fullPaths: [...(dirFullPaths.get(dir) || [])], sessIds, avgY };
    })
    .sort((a, b) => a.avgY - b.avgY);

  const dirNodes: DirNode[] = [];
  const edges: Edge[] = [];

  // Track column heights for grid packing
  const colHeights = new Array(DIR_GRID_COLS).fill(START_Y);

  for (const { dir, files, fullPaths, sessIds } of dirEntries) {
    const dirId = `dir-${dir}`;
    const height = DIR_HEADER_HEIGHT + files.length * DIR_FILE_HEIGHT + 8;

    // Pick the shortest column
    let col = 0;
    for (let c = 1; c < DIR_GRID_COLS; c++) {
      if (colHeights[c] < colHeights[col]) col = c;
    }

    const x = DIR_START_X + col * (DIR_WIDTH + DIR_COL_GAP);
    const y = colHeights[col];
    colHeights[col] = y + height + DIR_GAP;

    dirNodes.push({ id: dirId, dir, files, fullPaths, x, y, height });

    for (const sessId of sessIds) {
      edges.push({ id: `${sessId}--${dirId}`, sessionId: sessId, dirId });
    }
  }

  return { sessionNodes, dirNodes, edges };
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
  const { sessionNodes, dirNodes, edges } = useMemo(
    () => buildGraph(sessions, olderSessions, showOlder),
    [sessions, olderSessions, showOlder],
  );

  const allNodeIds = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of sessionNodes) map.set(n.id, { x: n.x, y: n.y });
    for (const n of dirNodes) map.set(n.id, { x: n.x, y: n.y });
    return map;
  }, [sessionNodes, dirNodes]);

  const [dragging, setDragging] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  // Selection: either a session node id or a dir node id
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const didDrag = useRef(false);
  const dragStart = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);
  const ctx = useTransformContext();

  const pos = useCallback((id: string) => {
    const base = allNodeIds.get(id);
    if (!base) return { x: 0, y: 0 };
    return {
      x: offsets[id]?.x ?? base.x,
      y: offsets[id]?.y ?? base.y,
    };
  }, [offsets, allNodeIds]);

  const maxX = Math.max(
    ...sessionNodes.map(n => pos(n.id).x + SESSION_WIDTH),
    ...dirNodes.map(n => pos(n.id).x + DIR_WIDTH),
    800,
  );
  const maxY = Math.max(
    ...sessionNodes.map(n => pos(n.id).y + SESSION_HEIGHT),
    ...dirNodes.map(n => pos(n.id).y + n.height),
    2000,
  );

  const olderHeaderY = START_Y + sessions.length * (SESSION_HEIGHT + SESSION_GAP);

  // Derive highlights from selected node (session or dir)
  const { highlightedSessions, highlightedDirs, highlightedEdges } = useMemo(() => {
    const hs = new Set<string>();
    const hd = new Set<string>();
    const he = new Set<string>();
    if (!selectedNode) return { highlightedSessions: hs, highlightedDirs: hd, highlightedEdges: he };

    if (selectedNode.startsWith('sess-')) {
      hs.add(selectedNode);
      for (const e of edges) {
        if (e.sessionId === selectedNode) {
          hd.add(e.dirId);
          he.add(e.id);
        }
      }
    } else if (selectedNode.startsWith('dir-')) {
      hd.add(selectedNode);
      for (const e of edges) {
        if (e.dirId === selectedNode) {
          hs.add(e.sessionId);
          he.add(e.id);
        }
      }
    }
    return { highlightedSessions: hs, highlightedDirs: hd, highlightedEdges: he };
  }, [selectedNode, edges]);

  const onPointerDown = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(nodeId);
    didDrag.current = false;
    const base = allNodeIds.get(nodeId);
    if (!base) return;
    const currentX = offsets[nodeId]?.x ?? base.x;
    const currentY = offsets[nodeId]?.y ?? base.y;
    dragStart.current = { x: e.clientX, y: e.clientY, nodeX: currentX, nodeY: currentY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    ctx.setup.disabled = true;
  }, [allNodeIds, offsets, ctx]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag.current = true;
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

  // Edge paths
  const edgePaths = useMemo(() => {
    return edges.map(edge => {
      const sn = sessionNodes.find(n => n.id === edge.sessionId);
      const dn = dirNodes.find(n => n.id === edge.dirId);
      if (!sn || !dn) return null;

      const sp = pos(sn.id);
      const dp = pos(dn.id);

      const x1 = sp.x + SESSION_WIDTH;
      const y1 = sp.y + SESSION_HEIGHT / 2;
      const x2 = dp.x;
      const y2 = dp.y + dn.height / 2;
      const cx = (x1 + x2) / 2;

      return {
        id: edge.id,
        d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
        highlighted: highlightedEdges.has(edge.id),
      };
    }).filter(Boolean) as { id: string; d: string; highlighted: boolean }[];
  }, [edges, sessionNodes, dirNodes, pos, highlightedEdges]);

  return (
    <>
      <ZoomControls />
      <TransformComponent
        wrapperStyle={{ width: '100%', height: '100%', background: 'transparent' }}
        contentStyle={{ width: maxX + 200, height: maxY + 200 }}
      >
        <div
          className="canvas-world"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => {
            // Deselect when clicking canvas background (not a node)
            if (e.target === e.currentTarget) setSelectedNode(null);
          }}
        >
          <svg className="canvas-edges">
            {edgePaths.map(ep => (
              <path
                key={ep.id}
                d={ep.d}
                className={ep.highlighted ? 'edge-highlighted' : ''}
              />
            ))}
          </svg>

          {/* Session cards */}
          {sessionNodes.map(node => {
            const p = pos(node.id);
            const isHighlighted = highlightedSessions.has(node.id);
            return (
              <div
                key={node.id}
                className={`canvas-node${isHighlighted ? ' graph-highlighted' : ''}`}
                style={{ left: p.x, top: p.y }}
                onPointerDown={e => onPointerDown(node.id, e)}
                onPointerUp={() => {
                  if (!didDrag.current) {
                    setSelectedNode(prev => prev === node.id ? null : node.id);
                    onSelectSession?.(node.session, projectId);
                  }
                }}
              >
                <SessionCard
                  session={node.session}
                  projectId={projectId}
                  selected={selectedSessionId === node.session.sessionId}
                  onClick={() => {}}
                />
              </div>
            );
          })}

          {/* Directory cards */}
          {dirNodes.map(node => {
            const p = pos(node.id);
            return (
              <div
                key={node.id}
                className="canvas-node"
                style={{ left: p.x, top: p.y }}
                onPointerDown={e => onPointerDown(node.id, e)}
                onPointerUp={() => {
                  if (!didDrag.current) {
                    setSelectedNode(prev => prev === node.id ? null : node.id);
                  }
                }}
              >
                <DirCard
                  dir={node.dir}
                  files={node.files}
                  highlighted={highlightedDirs.has(node.id)}
                />
              </div>
            );
          })}

          {/* Older sessions toggle */}
          {olderSessions.length > 0 && (
            <div
              className="older-sessions-toggle"
              style={{ left: SESSION_X, top: olderHeaderY }}
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
