import { useState, useCallback, useRef, useEffect } from 'react';

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export function useSessionWS(projectId: string, sessionId: string) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'running' | 'done' | 'error'>('idle');
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current) return;

    const base = import.meta.env.DEV ? 'ws://localhost:3333' : `ws://${window.location.host}`;
    const ws = new WebSocket(`${base}/ws/sessions/${projectId}/${sessionId}`);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => setStatus('running');

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'status') {
          setStatus(data.status === 'done' ? 'done' : data.status === 'running' ? 'running' : 'idle');
        } else {
          setEvents(prev => [...prev, data]);
        }
      } catch {
        // ignore malformed
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      wsRef.current = null;
      setStatus('idle');
    };
  }, [projectId, sessionId]);

  const send = useCallback((prompt: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
      // Queue the send after connection
      const checkAndSend = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'prompt', prompt }));
          clearInterval(checkAndSend);
        }
      }, 100);
      setTimeout(() => clearInterval(checkAndSend), 5000);
    } else {
      wsRef.current.send(JSON.stringify({ type: 'prompt', prompt }));
    }
  }, [connect]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => { wsRef.current?.close(); };
  }, []);

  return { events, status, connect, send, disconnect };
}
