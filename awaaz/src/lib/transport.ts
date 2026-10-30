/**
 * One embedded Logos Delivery node (liblogosdelivery, via the LogosMessaging
 * native module) per app process. The phone is a full relay peer on the
 * Awaaz cluster (66, one shard); the hub's nwaku is its static peer and the
 * Store node it catches up from after being offline or reloaded.
 *
 * Self-healing: if the node has no relay peers for a few checks, it re-dials
 * the hub (the hub may have restarted or moved address).
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { fromByteArray, toByteArray } from 'base64-js';

import { HUB_HTTP_PORT } from '@/lib/config';

export type NetStatus = 'connecting' | 'online' | 'offline';

type HubInfo = { peerId: string; clusterId: number; numShardsInCluster: number };

const { LogosMessaging } = NativeModules as { LogosMessaging: any };

const HUB_TCP_PORT = 60000;
const CHECK_MS = 5_000;
const REDIAL_AFTER_MISSES = 2; // ~10 s without peers
const DIAL_TIMEOUT_MS = 10_000;
const STORE_TIMEOUT_MS = 15_000;
const STORE_WINDOW_MS = 23 * 3600_000; // stay under the store's 24 h limit

let hubHost = 'localhost';
let hubPeer: string | null = null;
let pubsubTopic = '/waku/2/rs/66/0';
let nodePromise: Promise<string> | null = null;
let eventSub: { remove: () => void } | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let status: NetStatus = 'connecting';
const listeners = new Set<(s: NetStatus) => void>();
const subscriptions = new Map<string, Set<(payload: Uint8Array) => void>>();

function setStatus(s: NetStatus) {
  if (s === status) return;
  status = s;
  listeners.forEach((l) => l(s));
}

export function onStatus(l: (s: NetStatus) => void): () => void {
  listeners.add(l);
  l(status);
  return () => listeners.delete(l);
}

export function hubBaseUrl(host: string): string {
  return `http://${host}:${HUB_HTTP_PORT}`;
}

function ipOf(host: string): string {
  return host === 'localhost' ? '127.0.0.1' : host;
}

async function fetchHubInfo(host: string): Promise<HubInfo> {
  const res = await fetch(`${hubBaseUrl(host)}/hub-info?host=${encodeURIComponent(ipOf(host))}`);
  if (!res.ok) throw new Error(`hub-info ${res.status}`);
  return res.json();
}

/** Waku message payloads arrive as base64 or a byte array depending on the event. */
function toBytes(payload: unknown): Uint8Array | null {
  if (Array.isArray(payload)) return Uint8Array.from(payload as number[]);
  if (typeof payload === 'string') {
    try {
      return toByteArray(payload);
    } catch {
      return null;
    }
  }
  return null;
}

function deliver(wm: any) {
  const handlers = wm ? subscriptions.get(wm.contentTopic) : undefined;
  const bytes = handlers ? toBytes(wm.payload) : null;
  if (handlers && bytes) handlers.forEach((h) => h(bytes));
}

function onNodeEvent(evt: { event: string }) {
  try {
    const m = JSON.parse(evt.event);
    deliver(m.wakuMessage || m.message || m);
  } catch {
    // Not a message event (peer connected, delivery report, ...).
  }
}

async function dialHub(ctx: string) {
  const info = await fetchHubInfo(hubHost);
  hubPeer = `/ip4/${ipOf(hubHost)}/tcp/${HUB_TCP_PORT}/p2p/${info.peerId}`;
  await LogosMessaging.connect(ctx, hubPeer, DIAL_TIMEOUT_MS);
}

async function startNode(): Promise<string> {
  if (!LogosMessaging) throw new Error('LogosMessaging native module not in this build');
  setStatus('connecting');
  const info = await fetchHubInfo(hubHost);
  hubPeer = `/ip4/${ipOf(hubHost)}/tcp/${HUB_TCP_PORT}/p2p/${info.peerId}`;
  pubsubTopic = `/waku/2/rs/${info.clusterId}/0`;

  if (!eventSub) eventSub = new NativeEventEmitter(LogosMessaging).addListener('logosMessage', onNodeEvent);
  await LogosMessaging.setup();
  const ctx: string = await LogosMessaging.new({
    mode: 'Core',
    clusterId: info.clusterId,
    numShardsInNetwork: info.numShardsInCluster,
    relay: true,
    // Simulators share the Mac's network stack (and Docker holds 60000), so
    // each node gets its own random ports. Core mode binds the discv5 UDP
    // port even with discovery off, so that one is randomised too.
    tcpPort: 61000 + Math.floor(Math.random() * 1000),
    discv5UdpPort: 62000 + Math.floor(Math.random() * 1000),
    discv5Discovery: false,
    dnsDiscovery: false,
    peerExchange: false,
    maxMessageSize: '512KiB',
    staticnodes: [hubPeer],
  });
  try {
    await LogosMessaging.start(ctx);
    await LogosMessaging.connect(ctx, hubPeer, DIAL_TIMEOUT_MS);
    for (const topic of subscriptions.keys()) await LogosMessaging.relaySubscribe(ctx, topic);
  } catch (e) {
    // Free the half-started node so retries don't pile up listeners.
    await LogosMessaging.stop(ctx).catch(() => {});
    await LogosMessaging.destroy(ctx).catch(() => {});
    throw e;
  }
  return ctx;
}

async function peerCount(ctx: string): Promise<number> {
  const n = parseInt(await LogosMessaging.numConnectedPeers(ctx, pubsubTopic), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Resolves once the node is running; retries every few seconds until it starts. */
function connect(): Promise<string> {
  if (!nodePromise) {
    nodePromise = (async () => {
      for (;;) {
        try {
          return await startNode();
        } catch (e) {
          console.log('[awaaz] node start failed, retrying:', e);
          setStatus('offline');
          await new Promise((r) => setTimeout(r, 4_000));
        }
      }
    })();
  }
  return nodePromise;
}

function startWatchdog() {
  if (watchdog) return;
  let misses = 0;
  watchdog = setInterval(async () => {
    if (!nodePromise) return;
    const ctx = await nodePromise;
    const peers = await peerCount(ctx).catch(() => 0);
    if (peers > 0) {
      misses = 0;
      setStatus('online');
      return;
    }
    setStatus('offline');
    if (++misses < REDIAL_AFTER_MISSES) return;
    misses = 0;
    console.log('[awaaz] no relay peers, re-dialing hub');
    dialHub(ctx).catch((e) => console.log('[awaaz] hub dial failed:', e));
  }, CHECK_MS);
}

function getNode(host: string): Promise<string> {
  hubHost = host;
  startWatchdog();
  return connect();
}

export async function publish(host: string, topic: string, payload: Uint8Array): Promise<boolean> {
  const ctx = await getNode(host);
  // Without a relay peer the message would go nowhere; leave it in the outbox.
  if ((await peerCount(ctx).catch(() => 0)) === 0) return false;
  await LogosMessaging.send(
    ctx,
    JSON.stringify({ contentTopic: topic, payload: fromByteArray(payload), ephemeral: false })
  );
  return true;
}

export async function subscribe(
  host: string,
  topic: string,
  onPayload: (payload: Uint8Array) => void
): Promise<void> {
  const isNewTopic = !subscriptions.has(topic);
  if (isNewTopic) subscriptions.set(topic, new Set());
  subscriptions.get(topic)!.add(onPayload);
  const ctx = await getNode(host);
  if (isNewTopic) await LogosMessaging.relaySubscribe(ctx, topic);
}

export async function history(
  host: string,
  topic: string,
  since: Date,
  onPayload: (payload: Uint8Array) => void
): Promise<void> {
  const ctx = await getNode(host);
  if (typeof LogosMessaging.storeQuery !== 'function' || !hubPeer) return;
  // Store nodes reject a query spanning more than 24 h ("time range exceeds
  // 24h"), so walk the range in day-sized windows, oldest first.
  const end = Date.now();
  for (let start = since.getTime(); start < end; start += STORE_WINDOW_MS) {
    const windowEnd = Math.min(start + STORE_WINDOW_MS, end);
    let cursor: string | undefined;
    do {
      const raw: string = await LogosMessaging.storeQuery(
        ctx,
        JSON.stringify({
          requestId: `${Date.now()}-${Math.random()}`,
          includeData: true,
          pubsubTopic,
          contentTopics: [topic],
          timeStart: start * 1_000_000,
          timeEnd: windowEnd * 1_000_000,
          paginationForward: true,
          paginationLimit: 100,
          ...(cursor ? { paginationCursor: cursor } : {}),
        }),
        hubPeer,
        STORE_TIMEOUT_MS
      );
      const res = JSON.parse(raw);
      for (const entry of res.messages ?? []) {
        const bytes = toBytes(entry.message?.payload);
        if (bytes) onPayload(bytes);
      }
      cursor = res.paginationCursor || undefined;
    } while (cursor);
  }
}
