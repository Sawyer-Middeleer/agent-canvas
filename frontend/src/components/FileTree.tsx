import { useState } from 'react';
import type { FileNode } from '../types';

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.isDir && node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={`filetree-row${node.isDir ? ' filetree-dir' : ''}`}
        style={{ paddingLeft: depth * 14 }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {node.isDir ? (
          <span className="filetree-icon">{hasChildren ? (expanded ? 'v' : '>') : '-'}</span>
        ) : (
          <span className="filetree-icon">-</span>
        )}
        <span className="filetree-name">{node.name}</span>
      </div>
      {expanded && hasChildren && node.children!.map(child => (
        <TreeNode key={child.name} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

interface Props {
  tree: FileNode | null;
  loading: boolean;
}

export function FileTree({ tree, loading }: Props) {
  if (loading) return <span className="context-empty">Loading...</span>;
  if (!tree) return <span className="context-empty">No file tree</span>;
  if (!tree.children || tree.children.length === 0) {
    return <span className="context-empty">Empty directory</span>;
  }

  return (
    <div className="filetree-root">
      {tree.children.map(child => (
        <TreeNode key={child.name} node={child} depth={0} />
      ))}
    </div>
  );
}
