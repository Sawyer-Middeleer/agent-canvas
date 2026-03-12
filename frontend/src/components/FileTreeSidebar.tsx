import type { FileNode } from '../types';
import { FileTree } from './FileTree';

interface Props {
  tree: FileNode | null;
  loading: boolean;
  onSelectFile?: (relPath: string) => void;
}

export function FileTreeSidebar({ tree, loading, onSelectFile }: Props) {
  return (
    <div className="filetree-sidebar">
      <div className="filetree-sidebar-title">Files</div>
      <div className="filetree-sidebar-content">
        <FileTree tree={tree} loading={loading} onSelectFile={onSelectFile} />
      </div>
    </div>
  );
}
