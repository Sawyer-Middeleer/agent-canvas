import type { FileNode } from '../types';
import { FileTree } from './FileTree';

interface Props {
  tree: FileNode | null;
  loading: boolean;
}

export function FileTreeSidebar({ tree, loading }: Props) {
  return (
    <div className="filetree-sidebar">
      <div className="filetree-sidebar-title">Files</div>
      <div className="filetree-sidebar-content">
        <FileTree tree={tree} loading={loading} />
      </div>
    </div>
  );
}
