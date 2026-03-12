import type { Skill, Config } from '../types';

interface Props {
  skills: Skill[];
  config: Config | null;
}

export function ProjectContextBar({ skills, config }: Props) {
  const hooks = config?.hooks || [];
  const plugins = config?.plugins || [];
  const permissions = config?.permissions || {};
  const permKeys = Object.keys(permissions);

  return (
    <div className="context-bar">
      {/* Skills card */}
      <div className="context-card">
        <div className="context-card-title">Skills</div>
        <div className="context-card-body">
          {skills.length === 0 && <span className="context-empty">No skills configured</span>}
          {skills.map(s => (
            <span key={s.name} className="pill skill" title={s.description}>
              /{s.name}
            </span>
          ))}
        </div>
      </div>

      {/* Hooks card */}
      <div className="context-card">
        <div className="context-card-title">Hooks</div>
        <div className="context-card-body">
          {hooks.length === 0 && <span className="context-empty">No hooks configured</span>}
          {hooks.map((h, i) => (
            <span key={i} className="pill hook" title={h.hooks.map(d => d.type).join(', ')}>
              {h.event}{h.matcher ? `: ${h.matcher}` : ''}
            </span>
          ))}
        </div>
      </div>

      {/* Plugins card */}
      <div className="context-card">
        <div className="context-card-title">Plugins</div>
        <div className="context-card-body">
          {plugins.length === 0 && <span className="context-empty">No plugins installed</span>}
          {plugins.map(p => (
            <span key={p.name} className="pill plugin" title={p.installs.map(i => `${i.scope} v${i.version}`).join(', ')}>
              {p.name}
            </span>
          ))}
        </div>
      </div>

      {/* Permissions card */}
      <div className="context-card">
        <div className="context-card-title">Permissions</div>
        <div className="context-card-body">
          {permKeys.length === 0 && <span className="context-empty">Default permissions</span>}
          {permKeys.map(key => (
            <span key={key} className="pill perm">
              {key}: {Array.isArray(permissions[key]) ? (permissions[key] as string[]).length : '1'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
