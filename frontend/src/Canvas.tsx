import { useState, useRef, useCallback } from 'react';
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';
import { SessionCard } from './components/SessionCard';
import { SkillCard } from './components/SkillCard';
import { ConfigPanel } from './components/ConfigPanel';
import type { Project, Session, Skill, Config } from './types';

interface Props {
  projects: Project[];
  sessionsByProject: Record<string, Session[]>;
  skills: Skill[];
  config: Config | null;
  onSelectSession?: (session: Session, projectId: string) => void;
  selectedSessionId?: string | null;
}

// Layout: single column of sessions when one project, columns when multiple
function layoutNodes(projects: Project[], sessionsByProject: Record<string, Session[]>) {
  const nodes: { id: string; x: number; y: number; type: string; data: unknown; projectId?: string }[] = [];

  const COL_WIDTH = 400;
  const ROW_HEIGHT = 130;
  const PROJECT_HEIGHT = 70;
  const START_X = 60;
  const START_Y = 60;

  projects.forEach((project, col) => {
    const x = START_X + col * COL_WIDTH;
    nodes.push({ id: `proj-${project.id}`, x, y: START_Y, type: 'project', data: project });

    const sessions = sessionsByProject[project.id] || [];
    sessions.forEach((session, row) => {
      nodes.push({
        id: `sess-${session.sessionId}`,
        x,
        y: START_Y + PROJECT_HEIGHT + row * ROW_HEIGHT,
        type: 'session',
        data: session,
        projectId: project.id,
      });
    });
  });

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

export function Canvas({ projects, sessionsByProject, skills, config, onSelectSession, selectedSessionId }: Props) {
  const nodes = layoutNodes(projects, sessionsByProject);
  const [dragging, setDragging] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const dragStart = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);

  const maxX = Math.max(...nodes.map(n => (offsets[n.id]?.x ?? n.x) + 360), 2000);
  const maxY = Math.max(...nodes.map(n => (offsets[n.id]?.y ?? n.y) + 200), 2000);

  const onPointerDown = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    setDragging(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const currentX = offsets[nodeId]?.x ?? node.x;
    const currentY = offsets[nodeId]?.y ?? node.y;
    dragStart.current = { x: e.clientX, y: e.clientY, nodeX: currentX, nodeY: currentY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [nodes, offsets]);

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
  }, []);

  const skillsX = Math.max(projects.length, 1) * 400 + 100;

  return (
    <TransformWrapper
      limitToBounds={false}
      minScale={0.1}
      maxScale={3}
      initialScale={0.75}
      initialPositionX={0}
      initialPositionY={0}
      panning={{
        velocityDisabled: true,
      }}
    >
      <ZoomControls />
      <TransformComponent
        wrapperStyle={{ width: '100%', height: 'calc(100vh - 40px)' }}
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

            if (node.type === 'project') {
              const proj = node.data as Project;
              return (
                <div
                  key={node.id}
                  className="canvas-node project-node"
                  style={{ left: x, top: y }}
                  onPointerDown={e => onPointerDown(node.id, e)}
                >
                  <div className="project-name">{proj.path.split('\\').pop()}</div>
                  <div className="project-path">{proj.path}</div>
                  <span className="badge">{proj.sessionCount} sessions</span>
                </div>
              );
            }

            if (node.type === 'session') {
              return (
                <div
                  key={node.id}
                  className="canvas-node"
                  style={{ left: x, top: y }}
                  onPointerDown={e => onPointerDown(node.id, e)}
                >
                  <SessionCard
                    session={node.data as Session}
                    projectId={node.projectId!}
                    selected={selectedSessionId === (node.data as Session).sessionId}
                    onClick={() => onSelectSession?.(node.data as Session, node.projectId!)}
                  />
                </div>
              );
            }
            return null;
          })}

          {skills.length > 0 && (
            <div className="canvas-node" style={{ left: skillsX, top: 60 }}>
              <div className="section-label">Skills</div>
              {skills.map(skill => (
                <div key={skill.name} style={{ marginBottom: 8 }}>
                  <SkillCard skill={skill} />
                </div>
              ))}
            </div>
          )}

          {config && (
            <div className="canvas-node" style={{ left: skillsX, top: 60 + skills.length * 100 + 40 }}>
              <ConfigPanel config={config} />
            </div>
          )}
        </div>
      </TransformComponent>
    </TransformWrapper>
  );
}
