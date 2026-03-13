import type { PermissionRequest } from '../hooks/useSession';

interface Props {
  permissions: PermissionRequest[];
  onRespond: (toolUseID: string, approved: boolean) => void;
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && input.command) {
    return String(input.command).length > 120
      ? String(input.command).slice(0, 120) + '...'
      : String(input.command);
  }
  if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'Read') && input.file_path) {
    return String(input.file_path);
  }
  if (toolName === 'Glob' && input.pattern) {
    return String(input.pattern);
  }
  if (toolName === 'Grep' && input.pattern) {
    return String(input.pattern);
  }
  // Fallback: show first key=value pair
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  const first = keys[0];
  const val = String(input[first]);
  return `${first}: ${val.length > 80 ? val.slice(0, 80) + '...' : val}`;
}

export function PermissionPrompt({ permissions, onRespond }: Props) {
  if (permissions.length === 0) return null;

  return (
    <div className="permission-prompts">
      {permissions.map(p => (
        <div key={p.toolUseID} className="permission-prompt">
          <div className="permission-header">
            <span className="permission-icon">&#9888;</span>
            <span className="permission-tool">{p.toolName}</span>
            <span className="permission-label">needs permission</span>
          </div>
          <div className="permission-detail">
            {summarizeInput(p.toolName, p.input)}
          </div>
          {p.decisionReason && (
            <div className="permission-reason">{p.decisionReason}</div>
          )}
          <div className="permission-actions">
            <button
              className="permission-allow"
              onClick={() => onRespond(p.toolUseID, true)}
            >
              Allow
            </button>
            <button
              className="permission-deny"
              onClick={() => onRespond(p.toolUseID, false)}
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
