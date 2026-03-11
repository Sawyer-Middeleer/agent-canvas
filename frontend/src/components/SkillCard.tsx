import type { Skill } from '../types';

interface Props {
  skill: Skill;
}

export function SkillCard({ skill }: Props) {
  return (
    <div className="skill-card" onClick={e => e.stopPropagation()}>
      <div className="skill-header">
        <span className="skill-name">/{skill.name}</span>
        {skill.trigger && <span className="badge trigger">{skill.trigger}</span>}
      </div>
      <div className="skill-desc">{skill.description}</div>
      {skill.matchTools && skill.matchTools.length > 0 && (
        <div className="skill-tools">
          {skill.matchTools.map(t => (
            <span key={t} className="badge tool">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
