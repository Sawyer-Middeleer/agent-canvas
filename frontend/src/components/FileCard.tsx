const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f0db4f',
  jsx: '#f0db4f',
  go: '#00add8',
  css: '#e44d26',
  html: '#e44d26',
  json: '#a8a8a8',
  md: '#a8a8a8',
  py: '#3572A5',
  rs: '#dea584',
};

function getExtColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_COLORS[ext] || 'var(--text-dim)';
}

interface DirCardProps {
  dir: string;
  files: string[];
  highlighted?: boolean;
}

export function DirCard({ dir, files, highlighted }: DirCardProps) {
  return (
    <div className={`dir-card${highlighted ? ' highlighted' : ''}`}>
      <div className="dir-card-header" title={dir}>
        {dir || '.'}
      </div>
      <div className="dir-card-files">
        {files.map(f => (
          <div
            key={f}
            className="dir-card-file"
            style={{ borderLeftColor: getExtColor(f) }}
            title={dir ? `${dir}/${f}` : f}
          >
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}
