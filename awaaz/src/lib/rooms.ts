/**
 * Anonymous speak-up rooms over Logos Delivery.
 *
 * A room is just a shared key (passed by invite link). Everything posted is
 * signed by a throwaway per-room identity — no account, no phone number, no
 * name — and encrypted with the room key, so Logos nodes only ever relay
 * ciphertext on a hashed topic. Voice never leaves the poster's side: the
 * hub turns it into text, the anonymity guard strips identifying details,
 * and only that text is published.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes as utf8 } from '@noble/hashes/utils';
import { bytesToUtf8, utf8ToBytes } from '@waku/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { decrypt, encrypt, newFamilyKey, newIdentity, sign, verify, type Identity } from '@/lib/crypto';
import { history, hubBaseUrl, onStatus, publish, subscribe, type NetStatus } from '@/lib/transport';

export type Room = {
  key: string;
  name: string;
  joinedAt: number;
  /** Throwaway identity for this room only; reset any time. */
  me: Identity;
  /** The room creator's moderator key: only it can mark issues handled or fixed. */
  owner?: string;
  /** Present only on the creator's phone. Kept apart from `me` so moderating never links to posting. */
  mod?: Identity;
  /** Announced on the hub's lobby so anyone nearby can join with one tap. */
  isPublic?: boolean;
};

export const CATEGORIES = {
  safety: { label: 'Safety', emoji: '🛡️' },
  harassment: { label: 'Harassment', emoji: '✋' },
  facilities: { label: 'Facilities', emoji: '🔧' },
  food: { label: 'Food', emoji: '🍽️' },
  health: { label: 'Health', emoji: '🩺' },
  money: { label: 'Money', emoji: '💰' },
  work: { label: 'Work', emoji: '💼' },
  idea: { label: 'Idea', emoji: '💡' },
  other: { label: 'Other', emoji: '💬' },
} as const;
export type Category = keyof typeof CATEGORIES;

export type PostStatus = 'open' | 'acknowledged' | 'resolved';

type Base = { v: 1; id: string; from: string; at: number; sig?: string };
export type PostMsg = Base & {
  type: 'post';
  text: string;
  category: Category;
  kind: 'voice' | 'text';
  /** How many identifying details the anonymity guard removed. */
  removed: number;
};
export type MeTooMsg = Base & { type: 'metoo'; postId: string };
export type StatusMsg = Base & { type: 'status'; postId: string; status: PostStatus };
export type RoomMsg = PostMsg | MeTooMsg | StatusMsg;

type Draft =
  | Omit<PostMsg, keyof Base>
  | Omit<MeTooMsg, keyof Base>
  | Omit<StatusMsg, keyof Base>;

/** What the room shows: a post plus everything said about it. */
export type FeedItem = PostMsg & {
  meToo: number;
  iMeToo: boolean;
  status: PostStatus;
  statusBy?: string;
  mine: boolean;
};

const HISTORY_DAYS = 14;

// --- Identity, names, links -------------------------------------------------

export function roomId(key: string): string {
  return bytesToHex(sha256(utf8(`awaaz-room:${key}`))).slice(0, 16);
}

export function roomTopic(key: string): string {
  return `/awaaz/1/room-${roomId(key)}/json`;
}

const ADJ = ['Quiet', 'Brave', 'Gentle', 'Swift', 'Bright', 'Calm', 'Bold', 'Kind', 'Clever', 'Steady', 'Silent', 'Lucky', 'Wise', 'Sunny', 'Wild', 'Honest'];
const ANIMAL = ['Tiger', 'Peacock', 'Elephant', 'Koel', 'Mongoose', 'Owl', 'Dolphin', 'Panda', 'Falcon', 'Otter', 'Leopard', 'Heron', 'Fox', 'Turtle', 'Sparrow', 'Yak'];

/** A friendly anonymous handle derived from a throwaway public key. */
export function handleFor(pub: string): string {
  const h = sha256(utf8(pub));
  return `${ADJ[h[0] % ADJ.length]} ${ANIMAL[h[1] % ANIMAL.length]}`;
}

const LINK_PREFIX = 'awaaz://room/';

export function inviteLink(room: Room): string {
  const owner = room.owner ? `&m=${room.owner}` : '';
  return `${LINK_PREFIX}${room.key}?n=${encodeURIComponent(room.name)}${owner}`;
}

/** Accepts an invite link (or a bare key) and returns its key, name and moderator key. */
export function parseInvite(input: string): { key: string; name: string; owner?: string } | null {
  const m = input.trim().match(/([0-9a-fA-F]{64})(\?\S*)?/);
  if (!m) return null;
  let name = 'Speak-up room';
  const n = m[2]?.match(/[?&]n=([^\s&]*)/);
  try {
    if (n?.[1]) name = decodeURIComponent(n[1]);
  } catch {
    // keep default
  }
  const owner = m[2]?.match(/[?&]m=([0-9a-fA-F]{64})/)?.[1]?.toLowerCase();
  return { key: m[1].toLowerCase(), name, owner };
}

// --- Local storage ----------------------------------------------------------

const K = {
  rooms: 'awaaz.rooms',
  messages: (id: string) => `awaaz.room.${id}.messages`,
  outbox: (id: string) => `awaaz.room.${id}.outbox`,
};

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

const setJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));

export const loadRooms = () => getJson<Room[]>(K.rooms, []);

export async function createRoom(name: string, isPublic = true): Promise<Room> {
  const rooms = await loadRooms();
  const mod = newIdentity();
  const room: Room = {
    key: newFamilyKey(),
    name: name.trim() || 'Speak-up room',
    joinedAt: Date.now(),
    me: newIdentity(),
    isPublic,
    owner: mod.pub,
    mod,
  };
  await setJson(K.rooms, [room, ...rooms]);
  return room;
}

export async function joinRoom(key: string, name: string, isPublic = false, owner?: string): Promise<Room> {
  const rooms = await loadRooms();
  const existing = rooms.find((r) => r.key === key);
  if (existing) {
    // Rooms joined before moderator keys existed learn theirs from a newer invite.
    if (!existing.owner && owner) {
      existing.owner = owner;
      await setJson(K.rooms, rooms);
    }
    return existing;
  }
  const room: Room = { key, name, joinedAt: Date.now(), me: newIdentity(), isPublic, owner };
  await setJson(K.rooms, [room, ...rooms]);
  return room;
}

export async function resetIdentity(key: string): Promise<Room | null> {
  const rooms = await loadRooms();
  const room = rooms.find((r) => r.key === key);
  if (!room) return null;
  room.me = newIdentity();
  await setJson(K.rooms, rooms);
  return room;
}

export async function leaveRoom(key: string): Promise<void> {
  const rooms = await loadRooms();
  const id = roomId(key);
  await setJson(K.rooms, rooms.filter((r) => r.key !== key));
  await AsyncStorage.multiRemove([K.messages(id), K.outbox(id)]);
}

/** Panic wipe: every Awaaz key on this device — rooms, identities, family, history. */
export async function wipeEverything(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('awaaz.'));
  await AsyncStorage.multiRemove(keys);
}

// --- Anonymity guard (runs on the community hub, not in any cloud) -----------

export type GuardResult = {
  text: string;
  original: string;
  removed: string[];
  category: Category;
  personalAttack: boolean;
  guard: 'qwen' | 'regex' | 'device' | 'none';
};

// Sources, not shared RegExp objects: a global regex's .test() keeps state.
const PHONE = String.raw`\+?\d[\d\s-]{7,}\d`;
const EMAIL = String.raw`[\w.+-]+@[\w-]+\.[\w.]+`;

/** Last-resort scrub on the device when the hub is unreachable (text only). */
function deviceGuard(text: string): GuardResult {
  const removed: string[] = [];
  let out = text;
  if (new RegExp(PHONE).test(out)) removed.push('a phone number');
  if (new RegExp(EMAIL).test(out)) removed.push('an email address');
  out = out.replace(new RegExp(PHONE, 'g'), '[removed]').replace(new RegExp(EMAIL, 'g'), '[removed]');
  return { text: out, original: text, removed, category: 'other', personalAttack: false, guard: 'device' };
}

/** Phone numbers and emails left in the final text, e.g. typed back in while editing. */
export function leftoverIdentifiers(text: string): string[] {
  const found: string[] = [];
  if (new RegExp(PHONE).test(text)) found.push('a phone number');
  if (new RegExp(EMAIL).test(text)) found.push('an email address');
  return found;
}

// Capitalised words that are ordinary English, not names.
const COMMON = new Set(
  ('I The A An And But Or So If When Then This That These Those We They He She It You My Our Their His Her ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July ' +
    'August September October November December Block Hostel Room Gate Canteen Mess Library Office').split(' ')
);

/**
 * A second opinion on the AI: capitalised words from what was said that are
 * still in the cleaned text, mid-sentence. Often places, sometimes a name the
 * guard missed, so the poster is asked to look, not forced to delete.
 */
export function wordsToCheck(original: string, cleaned: string): string[] {
  const said = new Set(original.match(/\b[A-Z][a-z]{2,}\b/g) ?? []);
  const out = new Set<string>();
  for (const sentence of cleaned.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/).slice(1); // the first word is capitalised anyway
    for (const w of words) {
      const word = w.replace(/[^A-Za-z]/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(word) && said.has(word) && !COMMON.has(word)) out.add(word);
    }
  }
  return [...out];
}

export async function anonymise(
  hubHost: string,
  input: { text: string } | { audio: string },
  // Speech-to-text plus the guard can take 10-20 s on a busy laptop hub.
  timeoutMs = 'audio' in input ? 60_000 : 30_000
): Promise<GuardResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${hubBaseUrl(hubHost)}/anon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('audio' in input ? { audio: input.audio, ext: '.m4a' } : { text: input.text }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`anon ${res.status}`);
    const j = await res.json();
    const category = (j.category in CATEGORIES ? j.category : 'other') as Category;
    return {
      text: String(j.text ?? ''),
      original: String(j.original ?? ''),
      removed: Array.isArray(j.removed) ? j.removed.map(String) : [],
      category,
      personalAttack: !!j.personal_attack,
      guard: j.guard === 'qwen' ? 'qwen' : 'regex',
    };
  } catch (e) {
    // Voice can't be posted without the hub: we never send raw audio.
    if ('audio' in input) throw e;
    return deviceGuard(input.text);
  } finally {
    clearTimeout(timer);
  }
}

// --- The room channel -------------------------------------------------------

function uuid(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function isRoomMsg(m: any): m is RoomMsg {
  if (m?.v !== 1 || typeof m.id !== 'string' || typeof m.at !== 'number') return false;
  if (m.type === 'post') return typeof m.text === 'string' && m.text.length <= 2000;
  if (m.type === 'metoo') return typeof m.postId === 'string';
  if (m.type === 'status') return typeof m.postId === 'string' && ['open', 'acknowledged', 'resolved'].includes(m.status);
  return false;
}

export function useRoom(room: Room, hubHost: string) {
  const id = roomId(room.key);
  const topic = roomTopic(room.key);
  const me = room.me;

  const [messages, setMessages] = useState<RoomMsg[]>([]);
  const [pending, setPending] = useState(0);
  const [net, setNet] = useState<NetStatus>('connecting');

  const byId = useRef(new Map<string, RoomMsg>());
  const outbox = useRef<RoomMsg[]>([]);
  const flushing = useRef(false);

  const commit = useCallback(() => {
    const all = [...byId.current.values()].sort((a, b) => b.at - a.at);
    setMessages(all);
    setJson(K.messages(id), all);
  }, [id]);

  const ingest = useCallback(
    (payload: Uint8Array) => {
      const plain = decrypt(payload, room.key);
      if (!plain) return;
      try {
        const m = JSON.parse(bytesToUtf8(plain));
        if (!isRoomMsg(m) || !verify(m) || byId.current.has(m.id)) return;
        byId.current.set(m.id, m);
        commit();
      } catch {
        // Not ours.
      }
    },
    [room.key, commit]
  );

  const flush = useCallback(async () => {
    if (flushing.current || outbox.current.length === 0) return;
    flushing.current = true;
    try {
      while (outbox.current.length > 0) {
        const m = outbox.current[0];
        const payload = encrypt(utf8ToBytes(JSON.stringify(m)), room.key);
        const ok = await publish(hubHost, topic, payload).catch(() => false);
        if (!ok) break;
        outbox.current.shift();
        await setJson(K.outbox(id), outbox.current);
        setPending(outbox.current.length);
      }
    } finally {
      flushing.current = false;
    }
  }, [hubHost, topic, id, room.key]);

  useEffect(() => {
    let cancelled = false;
    byId.current = new Map();
    const unsub = onStatus((s) => {
      setNet(s);
      if (s === 'online') flush();
    });

    // Filter/relay is the fast path; a periodic Store query is the safety net.
    // Only others' messages count as "seen", so our own sends never skip a gap.
    const catchUp = () => {
      const theirs = [...byId.current.values()].filter((m) => m.from !== me.pub);
      const newest = Math.max(0, ...theirs.map((m) => m.at));
      const since = Math.max(newest - 120_000, Date.now() - HISTORY_DAYS * 86_400_000);
      return history(hubHost, topic, new Date(since), ingest).catch((e) =>
        console.log('[awaaz] room store query failed:', e)
      );
    };

    (async () => {
      const cached = await getJson<RoomMsg[]>(K.messages(id), []);
      cached.forEach((m) => byId.current.set(m.id, m));
      outbox.current = await getJson<RoomMsg[]>(K.outbox(id), []);
      if (cancelled) return;
      setPending(outbox.current.length);
      commit();
      await subscribe(hubHost, topic, ingest);
      await catchUp();
      flush();
    })().catch((e) => console.log('[awaaz] room init failed:', e));

    const retry = setInterval(flush, 8_000);
    const poll = setInterval(catchUp, 10_000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(retry);
      clearInterval(poll);
    };
  }, [id, topic, hubHost, me.pub, ingest, flush, commit]);

  const send = useCallback(
    async (draft: Draft) => {
      const msg = sign({ v: 1, id: uuid(), from: me.pub, at: Date.now(), ...draft } as RoomMsg, me) as RoomMsg;
      byId.current.set(msg.id, msg);
      commit();
      outbox.current.push(msg);
      await setJson(K.outbox(id), outbox.current);
      setPending(outbox.current.length);
      flush();
    },
    [me, id, commit, flush]
  );

  /** Only the creator's phone holds the moderator key, so only it can change an issue's status. */
  const mod = room.mod;
  const setStatus = useCallback(
    async (postId: string, status: PostStatus) => {
      if (!mod) return;
      const msg = sign(
        { v: 1, id: uuid(), from: mod.pub, at: Date.now(), type: 'status', postId, status } as RoomMsg,
        mod
      ) as RoomMsg;
      byId.current.set(msg.id, msg);
      commit();
      outbox.current.push(msg);
      await setJson(K.outbox(id), outbox.current);
      setPending(outbox.current.length);
      flush();
    },
    [mod, id, commit, flush]
  );

  const feed = useMemo(() => buildFeed(messages, me.pub, room.owner), [messages, me.pub, room.owner]);

  return { feed, pending, net, send, setStatus, isModerator: !!mod, me };
}

/** Fold me-toos and status changes into their posts. */
export function buildFeed(messages: RoomMsg[], myPub: string, owner?: string): FeedItem[] {
  const meToo = new Map<string, Set<string>>();
  const status = new Map<string, StatusMsg>();
  for (const m of messages) {
    if (m.type === 'metoo') {
      if (!meToo.has(m.postId)) meToo.set(m.postId, new Set());
      meToo.get(m.postId)!.add(m.from);
    } else if (m.type === 'status' && owner && m.from === owner) {
      // Status from anyone but the room's moderator key is ignored.
      const cur = status.get(m.postId);
      if (!cur || m.at > cur.at) status.set(m.postId, m);
    }
  }
  const rank: Record<PostStatus, number> = { open: 0, acknowledged: 1, resolved: 2 };
  return messages
    .filter((m): m is PostMsg => m.type === 'post')
    .map((p) => {
      const voters = meToo.get(p.id) ?? new Set<string>();
      const st = status.get(p.id);
      return {
        ...p,
        meToo: voters.size,
        iMeToo: voters.has(myPub),
        status: st?.status ?? 'open',
        statusBy: st ? 'the room host' : undefined,
        mine: p.from === myPub,
      };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || b.meToo - a.meToo || b.at - a.at);
}
