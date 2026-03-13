import path from 'path';
import fs from 'fs';
import { claudeDir } from './claude-dir.js';
import { readSkills } from './skills.js';
import type { Config, Hook, HookDef, Plugin, PluginInstall } from '../types.js';

export function readConfig(): Config {
  const cfg: Config = {
    hooks: [],
    plugins: [],
    skills: [],
    settings: {},
    permissions: {},
  };

  // Read settings.json
  const settingsPath = path.join(claudeDir(), 'settings.json');
  try {
    const data = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(data) as Record<string, unknown>;
    cfg.settings = settings;

    if (settings.hooks) {
      cfg.hooks = parseHooks(settings.hooks);
    }
    if (settings.permissions && typeof settings.permissions === 'object') {
      cfg.permissions = settings.permissions as Record<string, unknown>;
    }
  } catch { /* no settings file */ }

  // Read installed_plugins.json
  const pluginsPath = path.join(claudeDir(), 'plugins', 'installed_plugins.json');
  try {
    const data = fs.readFileSync(pluginsPath, 'utf8');
    const pluginFile = JSON.parse(data) as { version: number; plugins: Record<string, PluginInstall[]> };
    for (const [name, installs] of Object.entries(pluginFile.plugins ?? {})) {
      cfg.plugins.push({ name, installs: installs ?? [] });
    }
  } catch { /* no plugins file */ }

  // Read skills
  cfg.skills = readSkills();

  return cfg;
}

function parseHooks(raw: unknown): Hook[] {
  if (!raw || typeof raw !== 'object') return [];
  const hooksMap = raw as Record<string, unknown>;
  const hooks: Hook[] = [];

  for (const [event, matchersRaw] of Object.entries(hooksMap)) {
    if (!Array.isArray(matchersRaw)) continue;
    for (const m of matchersRaw) {
      if (!m || typeof m !== 'object') continue;
      const mObj = m as Record<string, unknown>;
      const h: Hook = {
        event,
        matcher: (mObj.matcher as string) ?? '',
        hooks: [],
      };
      if (Array.isArray(mObj.hooks)) {
        for (const hk of mObj.hooks) {
          if (!hk || typeof hk !== 'object') continue;
          const hkObj = hk as Record<string, unknown>;
          const def: HookDef = { type: (hkObj.type as string) ?? '' };
          if (hkObj.prompt) def.prompt = hkObj.prompt as string;
          if (hkObj.command) def.command = hkObj.command as string;
          if (typeof hkObj.timeout === 'number') def.timeout = hkObj.timeout;
          h.hooks.push(def);
        }
      }
      hooks.push(h);
    }
  }
  return hooks;
}
