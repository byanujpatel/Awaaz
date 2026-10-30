/**
 * "Rooms nearby": public rooms announce themselves on a lobby content topic
 * on the community hub's Logos network, so people join with one tap instead
 * of pasting an invite link. A public room's key is visible to anyone on the
 * hub by design; private rooms are never announced and still need a link.
 */
import { bytesToUtf8, utf8ToBytes } from '@waku/sdk';
import { useEffect, useRef, useState } from 'react';

import { roomId, type Room } from '@/lib/rooms';
import { history, publish, subscribe } from '@/lib/transport';

const LOBBY_TOPIC = '/awaaz/1/lobby/json';
const LOBBY_DAYS = 3;

export type Announcement = {
  v: 1;
  type: 'announce';
  id: string;
  key: string;
  name: string;
  at: number;
  /** The creator's moderator key, so joiners know whose status updates count. */
  owner?: string;
};

function isAnnouncement(m: any): m is Announcement {
  return (
    m?.v === 1 &&
    m.type === 'announce' &&
    /^[0-9a-f]{64}$/.test(m.key) &&
    typeof m.name === 'string' &&
    m.name.length <= 80 &&
    typeof m.at === 'number' &&
    m.id === roomId(m.key) &&
    (m.owner === undefined || /^[0-9a-f]{64}$/.test(m.owner))
  );
}

/** Announce a public room; retries for a while if the hub isn't reachable yet. */
export async function announceRoom(hubHost: string, room: Room, tries = 6): Promise<boolean> {
  const msg: Announcement = {
    v: 1,
    type: 'announce',
    id: roomId(room.key),
    key: room.key,
    name: room.name,
    at: Date.now(),
    owner: room.owner,
  };
  const payload = utf8ToBytes(JSON.stringify(msg));
  for (let i = 0; i < tries; i++) {
    if (await publish(hubHost, LOBBY_TOPIC, payload).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

/** Public rooms seen on the lobby, newest first, one entry per room. */
export function useLobby(hubHost: string | null) {
  const [rooms, setRooms] = useState<Announcement[]>([]);
  const byId = useRef(new Map<string, Announcement>());

  useEffect(() => {
    if (!hubHost) return;
    let cancelled = false;
    const ingest = (payload: Uint8Array) => {
      try {
        const m = JSON.parse(bytesToUtf8(payload));
        if (!isAnnouncement(m)) return;
        const cur = byId.current.get(m.id);
        if (!cur || m.at > cur.at) byId.current.set(m.id, m);
        // Always publish the map to state: it can outlive a remount.
        if (!cancelled) setRooms([...byId.current.values()].sort((a, b) => b.at - a.at));
      } catch {
        // Not an announcement.
      }
    };
    const catchUp = () =>
      history(hubHost, LOBBY_TOPIC, new Date(Date.now() - LOBBY_DAYS * 86_400_000), ingest).catch((e) =>
        console.log('[awaaz] lobby catch-up failed:', e)
      );

    subscribe(hubHost, LOBBY_TOPIC, ingest)
      .then(catchUp)
      .catch((e) => console.log('[awaaz] lobby subscribe failed:', e));
    const poll = setInterval(catchUp, 15_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [hubHost]);

  return rooms;
}
