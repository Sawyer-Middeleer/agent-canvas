import { useState, useCallback, useRef, useEffect } from 'react';

interface StreamEvent {
  type: string;
  source?: string;
  [key: string]: unknown;
}

export interface PartialBlock {
  index: number;
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: string;
}

type Status = 'idle' | 'connecting' | 'running' | 'reconnecting' | 'done' | 'error';

export function useSessionWS(projectId: string, sessionId: string) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [partialBlocks, setPartialBlocks] = useState<PartialBlock[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const messageQueueRef = useRef<string[]>([]);
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    const base = import.meta.env.DEV ? 'ws://localhost:3333' : `ws://${window.location.host}`;
    const ws = new WebSocket(`${base}/ws/sessions/${projectId}/${sessionId}`);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setStatus('running');
      // Drain queued messages
      while (messageQueueRef.current.length > 0) {
        const msg = messageQueueRef.current.shift()!;
        ws.send(msg);
      }
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'status') {
          setStatus(data.status === 'done' ? 'done' : data.status === 'running' ? 'running' : 'idle');
        } else if (data.type === 'content_block_start') {
          const block = data.content_block as { type: string; name?: string } | undefined;
          setPartialBlocks(prev => [...prev, {
            index: data.index as number,
            type: block?.type || 'text',
            name: block?.name,
          }]);
        } else if (data.type === 'content_block_delta') {
          const delta = data.delta as { type: string; text?: string; thinking?: string; partial_json?: string } | undefined;
          if (!delta) return;
          setPartialBlocks(prev => prev.map(b => {
            if (b.index !== data.index) return b;
            if (delta.type === 'text_delta') return { ...b, text: (b.text || '') + (delta.text || '') };
            if (delta.type === 'thinking_delta') return { ...b, thinking: (b.thinking || '') + (delta.thinking || '') };
            if (delta.type === 'input_json_delta') return { ...b, input: (b.input || '') + (delta.partial_json || '') };
            return b;
          }));
        } else if (data.type === 'content_block_stop') {
          // Block complete — keep in partials until message_stop
        } else if (data.type === 'message_stop' || data.type === 'assistant') {
          // Full message arrived or message complete — clear partials
          setPartialBlocks([]);
          if (data.type === 'assistant') {
            setEvents(prev => [...prev, data]);
          }
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
      if (intentionalCloseRef.current) {
        intentionalCloseRef.current = false;
        setStatus('idle');
        return;
      }
      // Auto-reconnect with exponential backoff (max 3 attempts)
      if (reconnectAttemptsRef.current < 3) {
        const delay = 1000 * Math.pow(2, reconnectAttemptsRef.current);
        reconnectAttemptsRef.current++;
        setStatus('reconnecting');
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      } else {
        setStatus('idle');
      }
    };
  }, [projectId, sessionId]);

  const send = useCallback((prompt: string, action?: string, skipPermissions?: boolean) => {
    const payload: Record<string, unknown> = { type: 'prompt', prompt };
    if (action) payload.action = action;
    if (skipPermissions !== undefined) payload.skipPermissions = skipPermissions;
    const msg = JSON.stringify(payload);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    } else {
      messageQueueRef.current.push(msg);
      connect();
    }
  }, [connect]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { events, partialBlocks, status, connect, send, disconnect };
}
