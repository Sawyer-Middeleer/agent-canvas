import { useState } from 'react';
import type { FileNode } from '../types';

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  basePath: string;
  onSelectFile?: (relPath: string) => void;
}

function TreeNode({ node, depth, basePath, onSelectFile }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.isDir && node.children && node.children.length > 0;
  const relPath = basePath ? `${basePath}/${node.name}` : node.name;

  const handleClick = () => {
    if (node.isDir && hasChildren) {
      setExpanded(!expanded);
    } else if (!node.isDir && onSelectFile) {
      onSelectFile(relPath);
    }
  };

  return (
    <div>
      <div
        className={`filetree-row${node.isDir ? ' filetree-dir' : ''}${!node.isDir && onSelectFile ? ' filetree-file-clickable' : ''}`}
        style={{ paddingLeft: depth * 14 }}
        onClick={handleClick}
      >
        {node.isDir ? (
          <span className="filetree-icon">{hasChildren ? (expanded ? 'v' : '>') : '-'}</span>
        ) : (
          <span className="filetree-icon">-</span>
        )}
        <span className="filetree-name">{node.name}</span>
      </div>
      {expanded && hasChildren && node.children!.map(child => (
        <TreeNode key={child.name} node={child} depth={depth + 1} basePath={relPath} onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}

interface Props {
  tree: FileNode | null;
  loading: boolean;
  onSelectFile?: (relPath: string) => void;
}

export function FileTree({ tree, loading, onSelectFile }: Props) {
  if (loading) return <span className="context-empty">Loading...</span>;
  if (!tree) return <span className="context-empty">No file tree</span>;
  if (!tree.children || tree.children.length === 0) {
    return <span className="context-empty">Empty directory</span>;
  }

  return (
    <div className="filetree-root">
      {tree.children.map(child => (
        <TreeNode key={child.name} node={child} depth={0} basePath="" onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}
