/**
 * Family mode: encrypted check-ins, voice logs and settings on one topic.
 * Every message is signed by the sender's device key, encrypted with the
 * family key, and queued locally until the hub confirms it (offline queue).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { bytesToUtf8, utf8ToBytes } from '@waku/sdk';

import { DEFAULT_CHECKIN_BY, familyTopic, type TagKey } from '@/lib/config';
import { decrypt, encrypt, familyIdFromKey, sign, verify, type Identity } from '@/lib/crypto';
import {
  loadMessages,
  loadOutbox,
  saveMessages,
  saveOutbox,
  type Profile,
} from '@/lib/storage';
import { history, onStatus, publish, subscribe, type NetStatus } from '@/lib/transport';

type Base = { v: 1; id: string; from: string; name: string; role: Profile['role']; at: number; sig?: string };

export type CheckinMsg = Base & { type: 'checkin'; ok: true; tags: TagKey[] };
export type LogMsg = Base & {
  type: 'log';
  tags: TagKey[];
  audio: string;
  durationSec: number;
  /** Parakeet transcript made on the parent's phone before sending. */
  transcript?: string;
  /** Tags Qwen picked from the speech (subset of tags). */
  autoTags?: TagKey[];
};
export type SettingsMsg = Base & { type: 'settings'; checkinBy: string; tz: string };
export type FamilyMsg = CheckinMsg | LogMsg | SettingsMsg;

type Draft =
  | Omit<CheckinMsg, keyof Base>
  | Omit<LogMsg, keyof Base>
  | Omit<SettingsMsg, keyof Base>;

const HISTORY_DAYS = 7;

function uuid(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function isFamilyMsg(m: any): m is FamilyMsg {
  return (
    m?.v === 1 &&
    typeof m.id === 'string' &&
    typeof m.at === 'number' &&
    ['checkin', 'log', 'settings'].includes(m.type)
  );
}

export function useFamily(profile: Profile, identity: Identity, hubHost: string) {
  const familyId = familyIdFromKey(profile.familyKey);
  const topic = familyTopic(familyId);

  const [messages, setMessages] = useState<FamilyMsg[]>([]);
  const [pending, setPending] = useState(0);
  const [net, setNet] = useState<NetStatus>('connecting');

  const byId = useRef(new Map<string, FamilyMsg>());
  const outbox = useRef<FamilyMsg[]>([]);
  const flushing = useRef(false);

  const commit = useCallback(() => {
    const all = [...byId.current.values()].sort((a, b) => b.at - a.at);
    setMessages(all);
    saveMessages(familyId, all);
  }, [familyId]);

  const ingest = useCallback(
    (payload: Uint8Array) => {
      const plain = decrypt(payload, profile.familyKey);
      if (!plain) return;
      try {
        const m = JSON.parse(bytesToUtf8(plain));
        if (!isFamilyMsg(m) || !verify(m) || byId.current.has(m.id)) return;
        byId.current.set(m.id, m);
        commit();
      } catch {
        // Not ours.
      }
    },
    [profile.familyKey, commit]
  );

  const flush = useCallback(async () => {
    if (flushing.current || outbox.current.length === 0) return;
    flushing.current = true;
    try {
      while (outbox.current.length > 0) {
        const m = outbox.current[0];
        const payload = encrypt(utf8ToBytes(JSON.stringify(m)), profile.familyKey);
        const ok = await publish(hubHost, topic, payload).catch(() => false);
        if (!ok) break;
        outbox.current.shift();
        await saveOutbox(familyId, outbox.current);
        setPending(outbox.current.length);
      }
    } finally {
      flushing.current = false;
    }
  }, [hubHost, topic, familyId, profile.familyKey]);

  useEffect(() => {
    let cancelled = false;
    const unsub = onStatus((s) => {
      setNet(s);
      if (s === 'online') flush();
    });

    // Filter is the fast path; a periodic Store query is the safety net for
    // anything Filter dropped while the connection was flaky. Only others'
    // messages count as "seen", so our own fresh sends never skip a gap.
    const catchUp = () => {
      const theirs = [...byId.current.values()].filter((m) => m.from !== identity.pub);
      const newest = Math.max(0, ...theirs.map((m) => m.at));
      const since = Math.max(newest - 120_000, Date.now() - HISTORY_DAYS * 86_400_000);
      return history(hubHost, topic, new Date(since), ingest).catch((e) =>
        console.log('[awaaz] store query failed:', e)
      );
    };

    (async () => {
      const cached = await loadMessages<FamilyMsg>(familyId);
      cached.forEach((m) => byId.current.set(m.id, m));
      outbox.current = await loadOutbox<FamilyMsg>(familyId);
      if (cancelled) return;
      setPending(outbox.current.length);
      commit();

      await subscribe(hubHost, topic, ingest);
      await catchUp();
      flush();
    })().catch((e) => console.log('[awaaz] family init failed:', e));

    const retry = setInterval(flush, 8_000);
    const poll = setInterval(catchUp, 10_000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(retry);
      clearInterval(poll);
    };
  }, [familyId, topic, hubHost, identity.pub, ingest, flush, commit]);

  const send = useCallback(
    async (draft: Draft) => {
      const msg = sign(
        {
          v: 1,
          id: uuid(),
          from: identity.pub,
          name: profile.name,
          role: profile.role,
          at: Date.now(),
          ...draft,
        } as FamilyMsg,
        identity
      ) as FamilyMsg;
      byId.current.set(msg.id, msg);
      commit();
      outbox.current.push(msg);
      await saveOutbox(familyId, outbox.current);
      setPending(outbox.current.length);
      flush();
    },
    [identity, profile.name, profile.role, familyId, commit, flush]
  );

  const settings = messages.find((m): m is SettingsMsg => m.type === 'settings');
  const checkinBy = settings?.checkinBy ?? DEFAULT_CHECKIN_BY;

  return { messages, pending, net, send, checkinBy, familyId };
}

export { checkinState } from '@/lib/checkin';
