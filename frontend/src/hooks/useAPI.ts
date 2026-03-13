import { useState, useEffect, useCallback } from 'react';
import type { Project, Session, TranscriptMessage, Skill, Config, FileNode, FileContent } from '../types';

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

  const refresh = useCallback(() => {
    if (!projectId) return;
    fetchJSON<Session[]>(`/api/projects/${projectId}/sessions`)
      .then(data => setSessions(data || []))
      .catch(() => setSessions([]));
  }, [projectId]);

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

  return { sessions, loading, refresh };
}

export interface TranscriptResult {
  messages: TranscriptMessage[];
  totalCount: number;
  hasMore: boolean;
}

export async function fetchTranscript(
  projectId: string,
  sessionId: string,
  limit?: number,
  offset?: number,
): Promise<TranscriptResult> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params}` : '';
  const res = await fetch(`${API_BASE}/api/sessions/${projectId}/${sessionId}/transcript${qs}`);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const totalCount = parseInt(res.headers.get('X-Total-Count') || '0', 10);
  const messages: TranscriptMessage[] = await res.json();
  const loaded = (offset || 0) + messages.length;
  return { messages, totalCount, hasMore: loaded < totalCount };
}

export async function archiveSession(projectId: string, sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${projectId}/${sessionId}/archive`, { method: 'POST' });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
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

export async function fetchFileContent(projectId: string, relPath: string): Promise<FileContent> {
  return fetchJSON<FileContent>(`/api/projects/${projectId}/file?path=${encodeURIComponent(relPath)}`);
}

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    fetchJSON<Config>('/api/config').then(setConfig).catch(() => {});
  }, []);
  return config;
}
