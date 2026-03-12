import { useState, useEffect } from 'react';
import type { FileContent } from '../types';
import { fetchFileContent } from '../hooks/useAPI';

interface Props {
  projectId: string;
  filePath: string;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewerPane({ projectId, filePath, onClose }: Props) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setFile(null);
    fetchFileContent(projectId, filePath)
      .then(setFile)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, filePath]);

  return (
    <div className="file-viewer-pane">
      <div className="file-viewer-header">
        <div className="file-viewer-title">
          <span className="file-viewer-name">{filePath.split('/').pop()}</span>
          {file && <span className="file-viewer-size">{formatSize(file.size)}</span>}
        </div>
        <button className="detail-close" onClick={onClose}>&times;</button>
      </div>
      <div className="file-viewer-path">{filePath}</div>

      <div className="file-viewer-content">
        {loading && <div className="loading">Loading file...</div>}
        {error && (
          <div className="file-viewer-not-found">
            <div className="file-viewer-not-found-icon">?</div>
            <div className="file-viewer-not-found-title">File not found</div>
            <div className="file-viewer-not-found-detail">
              This file was referenced in a session but no longer exists on disk.
              It may have been renamed, deleted, or was a failed tool target.
            </div>
            <div className="file-viewer-not-found-path">{filePath}</div>
          </div>
        )}
        {file?.isBinary && (
          <div className="file-viewer-binary">Binary file ({formatSize(file.size)})</div>
        )}
        {file && !file.isBinary && (
          <>
            {file.truncated && (
              <div className="file-viewer-truncated">
                File truncated (showing first 1 MB of {formatSize(file.size)})
              </div>
            )}
            <pre className="file-viewer-code">
              <code>{file.content}</code>
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
