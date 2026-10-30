/**
 * Unified chat hook. Picks the messaging backend per platform:
 *  - Android dev-client → embedded native Logos Delivery node (cluster 2 /
 *    logos.dev — interops with Basecamp delivery_module apps)
 *  - everywhere else (iOS, web, Expo Go) → js-waku light node (cluster 1 /
 *    Waku sandbox+test fleets)
 * Both expose the same state/return shape as the original useWakuChat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { deliveryAvailable, startNativeChat, type NativeChatHandle } from '@/lib/delivery-native';
import {
  CONTENT_TOPIC,
  useWakuChat,
  type ChatMessage,
  type WakuStatus,
} from '@/lib/waku-chat';

export { CONTENT_TOPIC, makeNick } from '@/lib/waku-chat';
export type { ChatMessage, WakuStatus } from '@/lib/waku-chat';

export const nativeBackend = deliveryAvailable();

function randomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function useNativeDeliveryChat(nick: string) {
  const [status, setStatus] = useState<WakuStatus>('starting');
  const [peerCount, setPeerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const handleRef = useRef<NativeChatHandle | null>(null);
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
    (async () => {
      try {
        console.log('[delivery] starting native node');
        const handle = await startNativeChat({
          topic: CONTENT_TOPIC,
          onStatus: (s) => {
            console.log('[delivery]', s);
            if (!cancelled && s === 'joining mesh') setStatus('waiting-peers');
          },
          onPayload: (json) => {
            try {
              const body = JSON.parse(json);
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
          },
        });
        if (cancelled) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        // The mesh takes a few seconds to form after the dials; call it ready
        // once the settle window passes (mirrors perun's SETTLE_MS), then keep
        // the REAL relay peer count fresh.
        const pollPeers = async () => {
          const n = await handle.numConnectedPeers();
          if (!cancelled && n >= 0) setPeerCount(n);
        };
        setTimeout(() => {
          if (!cancelled) {
            setStatus('ready');
            pollPeers();
          }
        }, 10_000);
        const peerPoll = setInterval(pollPeers, 5_000);
        const prevStop = handle.stop;
        handle.stop = async () => {
          clearInterval(peerPoll);
          await prevStop();
        };
        console.log('[delivery] node up, ctx:', handle.ctx);
      } catch (e) {
        console.log('[delivery] init failed:', e);
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, [appendMessage]);

  const send = useCallback(
    async (text: string) => {
      const handle = handleRef.current;
      const trimmed = text.trim();
      if (!handle || trimmed.length === 0) return false;
      const msg: ChatMessage = {
        id: randomId(),
        nick: nickRef.current,
        text: trimmed,
        ts: Date.now(),
        mine: true,
      };
      await handle.send(JSON.stringify({ id: msg.id, nick: msg.nick, text: msg.text, ts: msg.ts }));
      appendMessage(msg);
      return true;
    },
    [appendMessage]
  );

  return { status, health: undefined, peerCount, error, messages, send };
}

// Both branches of this conditional are hooks with identical shapes; the
// condition is constant for the lifetime of the process, so hook order is
// stable and the rules-of-hooks are satisfied at runtime.
export function useChat(nick: string) {
  /* eslint-disable react-hooks/rules-of-hooks */
  return nativeBackend ? useNativeDeliveryChat(nick) : useWakuChat(nick);
  /* eslint-enable react-hooks/rules-of-hooks */
}
