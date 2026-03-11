import type { Config } from '../types';

interface Props {
  config: Config;
}

export function ConfigPanel({ config }: Props) {
  return (
    <div className="config-panel" onClick={e => e.stopPropagation()}>
      <h3>Configuration</h3>

      {config.hooks && config.hooks.length > 0 && (
        <section>
          <h4>Hooks</h4>
          {config.hooks.map((h, i) => (
            <div key={i} className="config-item">
              <span className="badge">{h.event}</span>
              <span className="config-detail">{h.matcher || 'all'}</span>
              <div className="hook-defs">
                {h.hooks.map((def, j) => (
                  <div key={j} className="hook-def">
                    <span className="badge type">{def.type}</span>
                    {def.timeout && <span className="badge">{def.timeout}s</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {config.plugins && config.plugins.length > 0 && (
        <section>
          <h4>Plugins</h4>
          {config.plugins.map(p => (
            <div key={p.name} className="config-item">
              <span className="plugin-name">{p.name}</span>
              {p.installs.map((inst, i) => (
                <span key={i} className="badge">{inst.scope} v{inst.version}</span>
              ))}
            </div>
          ))}
        </section>
      )}

      {config.permissions && Object.keys(config.permissions).length > 0 && (
        <section>
          <h4>Permissions</h4>
          {Object.entries(config.permissions).map(([key, val]) => (
            <div key={key} className="config-item">
              <span className="perm-key">{key}</span>
              <div className="perm-values">
                {Array.isArray(val) && val.map((v, i) => (
                  <span key={i} className="badge perm">{String(v)}</span>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
