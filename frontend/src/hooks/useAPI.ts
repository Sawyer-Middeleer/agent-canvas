import { useState, useEffect, useCallback } from 'react';
import type { Project, Session, TranscriptMessage, Skill, Config, FileNode } from '../types';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3333' : '';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchJSON<Project[]>('/api/projects');
      setProjects(data || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { projects, loading, error, refresh };
}

export function useSessions(projectId: string | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) { setSessions([]); return; }
    setLoading(true);
    fetchJSON<Session[]>(`/api/projects/${projectId}/sessions`)
      .then(data => setSessions(data || []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));

    // Poll every 10s to keep active session indicators fresh
    const interval = setInterval(() => {
      fetchJSON<Session[]>(`/api/projects/${projectId}/sessions`)
        .then(data => setSessions(data || []))
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [projectId]);

  return { sessions, loading };
}

export async function fetchTranscript(projectId: string, sessionId: string, limit?: number): Promise<TranscriptMessage[]> {
  const params = limit ? `?limit=${limit}` : '';
  return fetchJSON<TranscriptMessage[]>(`/api/sessions/${projectId}/${sessionId}/transcript${params}`);
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    fetchJSON<Skill[]>('/api/skills').then(setSkills).catch(() => {});
  }, []);
  return skills;
}

export function useFileTree(projectId: string | null) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) { setTree(null); return; }
    setLoading(true);
    fetchJSON<FileNode>(`/api/projects/${projectId}/filetree`)
      .then(setTree)
      .catch(() => setTree(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  return { tree, loading };
}

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    fetchJSON<Config>('/api/config').then(setConfig).catch(() => {});
  }, []);
  return config;
}
