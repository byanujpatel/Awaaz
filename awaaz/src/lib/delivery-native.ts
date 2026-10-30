/**
 * Native Logos Delivery backend — the phone runs its OWN embedded
 * liblogosdelivery node (the same Nim library Basecamp's delivery_module
 * wraps) via the LogosMessaging native module, joining cluster 2 (logos.dev)
 * over raw TCP. Android-only until the iOS build of the library lands.
 *
 * Wiring cribbed from vpavlin/perun + xAlisher/receiver-android (proven
 * full-duplex on-device).
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { fromByteArray, toByteArray } from 'base64-js';

const { LogosMessaging } = NativeModules as { LogosMessaging: any };

// logos.dev bootstrap peers — the same set desktop delivery_module dials.
const BOOTSTRAP = [
  '/dns4/delivery-01.do-ams3.logos.dev.status.im/tcp/30303/p2p/16Uiu2HAmTUbnxLGT9JvV6mu9oPyDjqHK4Phs1VDJNUgESgNSkuby',
  '/dns4/delivery-02.do-ams3.logos.dev.status.im/tcp/30303/p2p/16Uiu2HAmMK7PYygBtKUQ8EHp7EfaD3bCEsJrkFooK8RQ2PVpJprH',
  '/dns4/delivery-01.gc-us-central1-a.logos.dev.status.im/tcp/30303/p2p/16Uiu2HAm4S1JYkuzDKLKQvwgAhZKs9otxXqt8SCGtB4hoJP1S397',
  '/dns4/delivery-02.gc-us-central1-a.logos.dev.status.im/tcp/30303/p2p/16Uiu2HAm8Y9kgBNtjxvCnf1X6gnZJW5EGE4UwwCL3CCm55TwqBiH',
  '/dns4/delivery-01.ac-cn-hongkong-c.logos.dev.status.im/tcp/30303/p2p/16Uiu2HAm8YokiNun9BkeA1ZRmhLbtNUvcwRr64F69tYj9fkGyuEP',
  '/dns4/delivery-02.ac-cn-hongkong-c.logos.dev.status.im/tcp/30303/p2p/16Uiu2HAkvwhGHKNry6LACrB8TmEFoCJKEX29XR5dDUzk3UT3UNSE',
];

// Extra peers to dial directly (e.g. the laptop's Basecamp delivery node for
// LAN interop, mirroring shared_color's staticNodes trick). The logos.dev
// fleet's preset peer IDs are stale upstream, so a static peer is currently
// the reliable route to a live cluster-2 mesh.
export const STATIC_PEERS: string[] = [];

const CONNECT_TIMEOUT_MS = 10_000;

/** True if this build carries the native module (Android dev-client). */
export function deliveryAvailable(): boolean {
  return !!LogosMessaging;
}

function utf8ToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i)!;
    if (c > 0xffff) i++;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000)
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
  }
  return new Uint8Array(out);
}

function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      );
      i += 3;
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
}

/** Decode a message_received payload (byte array | base64 | raw JSON string). */
function decodePayload(payload: unknown): string | null {
  if (Array.isArray(payload)) return bytesToUtf8(Uint8Array.from(payload as number[]));
  if (typeof payload === 'string') {
    try {
      return bytesToUtf8(toByteArray(payload));
    } catch {
      return payload;
    }
  }
  return null;
}

export type NativeChatHandle = {
  ctx: string;
  numConnectedPeers: () => Promise<number>;
  send: (bodyJson: string) => Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Bring up the embedded node, subscribe to `topic`, and deliver each received
 * message's decoded JSON-string payload to `onPayload`.
 */
export async function startNativeChat(opts: {
  topic: string;
  onPayload: (json: string) => void;
  onStatus?: (status: string) => void;
}): Promise<NativeChatHandle> {
  if (!LogosMessaging) throw new Error('LogosMessaging native module not in this build');
  const { topic, onPayload, onStatus } = opts;

  const emitter = new NativeEventEmitter(LogosMessaging);
  const sub = emitter.addListener('logosMessage', (evt: { wakuPtr: string; event: string }) => {
    try {
      const m = JSON.parse(evt.event);
      const wm = m.wakuMessage || m.message || m;
      const ct = wm.contentTopic || m.contentTopic;
      if (ct && ct !== topic) return;
      if (!wm.payload) return;
      const json = decodePayload(wm.payload);
      if (json) onPayload(json);
    } catch {
      // Non-message event (peer connected, etc.) — ignore.
    }
  });

  onStatus?.('starting node');
  await LogosMessaging.setup();
  const ctx: string = await LogosMessaging.new({
    mode: 'Core',
    preset: 'logos.dev',
    relay: true,
    entryNodes: BOOTSTRAP,
  });
  await LogosMessaging.start(ctx);

  onStatus?.('dialing peers');
  for (const peer of [...STATIC_PEERS, ...BOOTSTRAP]) {
    LogosMessaging.connect(ctx, peer, CONNECT_TIMEOUT_MS).catch(() => {
      // Expected for stale/dead fleet peers — the mesh forms from whoever answers.
    });
  }

  await LogosMessaging.relaySubscribe(ctx, topic);
  onStatus?.('joining mesh');

  return {
    ctx,
    numConnectedPeers: async (): Promise<number> => {
      // "" = all relay peers. Older bridge builds lack the method — return -1
      // so callers can fall back to "joined" semantics.
      if (typeof LogosMessaging.numConnectedPeers !== 'function') return -1;
      try {
        const n = parseInt(await LogosMessaging.numConnectedPeers(ctx, ''), 10);
        return Number.isFinite(n) ? n : -1;
      } catch {
        return -1;
      }
    },
    send: async (bodyJson: string) => {
      const messageJson = JSON.stringify({
        contentTopic: topic,
        payload: fromByteArray(utf8ToBytes(bodyJson)),
        ephemeral: false,
      });
      await LogosMessaging.send(ctx, messageJson);
    },
    stop: async () => {
      sub.remove();
      try {
        await LogosMessaging.stop(ctx);
      } catch {
        // best-effort
      }
    },
  };
}
