import { useCallback, useEffect, useRef, useState } from 'react';

import {
  bytesToUtf8,
  createLightNode,
  HealthStatus,
  Protocols,
  utf8ToBytes,
  WakuEvent,
  type IDecodedMessage,
  type LightNode,
} from '@waku/sdk';

export const CONTENT_TOPIC = '/cockroach/1/chat/json';

export type ChatMessage = {
  id: string;
  nick: string;
  text: string;
  ts: number;
  mine: boolean;
};

export type WakuStatus = 'starting' | 'waiting-peers' | 'ready' | 'error';

function randomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeNick(): string {
  return `roach-${randomId().slice(0, 4)}`;
}

export function useWakuChat(nick: string) {
  const [status, setStatus] = useState<WakuStatus>('starting');
  const [health, setHealth] = useState<HealthStatus>(HealthStatus.Unhealthy);
  const [peerCount, setPeerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const wakuRef = useRef<LightNode | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const nickRef = useRef(nick);
  nickRef.current = nick;

  const appendMessage = useCallback((msg: ChatMessage) => {
    if (seenIds.current.has(msg.id)) return;
    seenIds.current.add(msg.id);
    setMessages((prev) => [msg, ...prev]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let peerPoll: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        console.log('[waku] creating light node');
        const waku = await createLightNode({ defaultBootstrap: true });
        console.log('[waku] node created, peerId:', waku.peerId.toString());
        if (cancelled) {
          await waku.stop();
          return;
        }
        wakuRef.current = waku;

        waku.events.addEventListener(WakuEvent.Health, (event) => {
          if (!cancelled) setHealth(event.detail);
        });

        await waku.start();
        if (cancelled) return;
        setStatus('waiting-peers');

        peerPoll = setInterval(() => {
          waku
            .getConnectedPeers()
            .then((peers) => {
              if (!cancelled) setPeerCount(peers.length);
            })
            .catch(() => {});
        }, 3000);

        try {
          await waku.waitForPeers([Protocols.LightPush, Protocols.Filter], 45_000);
        } catch {
          // Keep going — filter/lightpush retry internally as peers appear.
        }
        if (cancelled) return;

        const decoder = waku.createDecoder({ contentTopic: CONTENT_TOPIC });
        await waku.filter?.subscribe(decoder, (message: IDecodedMessage) => {
          try {
            const body = JSON.parse(bytesToUtf8(message.payload));
            if (typeof body?.id !== 'string' || typeof body?.text !== 'string') return;
            appendMessage({
              id: body.id,
              nick: typeof body.nick === 'string' ? body.nick : 'anon',
              text: body.text,
              ts: typeof body.ts === 'number' ? body.ts : Date.now(),
              mine: false,
            });
          } catch {
            // Not our JSON — ignore.
          }
        });
        console.log('[waku] filter subscribed, ready');
        if (!cancelled) setStatus('ready');
      } catch (e) {
        console.log('[waku] init failed:', e, (e as any)?.stack);
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (peerPoll) clearInterval(peerPoll);
      wakuRef.current?.stop().catch(() => {});
      wakuRef.current = null;
    };
  }, [appendMessage]);

  const send = useCallback(
    async (text: string) => {
      const waku = wakuRef.current;
      const trimmed = text.trim();
      if (!waku?.lightPush || trimmed.length === 0) return false;

      const msg: ChatMessage = {
        id: randomId(),
        nick: nickRef.current,
        text: trimmed,
        ts: Date.now(),
        mine: true,
      };

      const encoder = waku.createEncoder({ contentTopic: CONTENT_TOPIC });
      const result = await waku.lightPush.send(
        encoder,
        {
          payload: utf8ToBytes(
            JSON.stringify({ id: msg.id, nick: msg.nick, text: msg.text, ts: msg.ts })
          ),
          timestamp: new Date(msg.ts),
        },
        { autoRetry: true }
      );

      const delivered = result.successes.length > 0;
      if (delivered) appendMessage(msg);
      return delivered;
    },
    [appendMessage]
  );

  return { status, health, peerCount, error, messages, send };
}

// hermes-polyfill-iteration-1
