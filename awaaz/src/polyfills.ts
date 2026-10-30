/**
 * Runtime polyfills required by js-waku (libp2p) under Hermes.
 * Must be imported before anything that touches @waku/* — keep this the
 * first import in src/app/_layout.tsx.
 *
 * Everything here is conditional: on web (and future Hermes versions that
 * grow these APIs) the native implementation wins.
 */
import 'react-native-url-polyfill/auto';

import { getRandomValues } from 'expo-crypto';

const g = globalThis as any;

// --- TextEncoder / TextDecoder (protobuf + uint8arrays) ---
if (typeof g.TextEncoder === 'undefined' || typeof g.TextDecoder === 'undefined') {
  require('fast-text-encoding');
}

// --- Web Crypto: getRandomValues (noble curves/ciphers entropy) ---
if (g.crypto == null) {
  g.crypto = {};
}
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = getRandomValues;
}

// --- Web Crypto: subtle.digest ---
// multiformats' browser build hashes secp256k1 peer IDs with
// crypto.subtle.digest during the noise handshake. Only digest is shimmed;
// the other subtle methods stay undefined so @libp2p/crypto's feature
// probes (e.g. WebCrypto Ed25519) still fail over to pure-JS @noble paths.
if (g.crypto.subtle == null) {
  const { sha256 } = require('@noble/hashes/sha256');
  const { sha384, sha512 } = require('@noble/hashes/sha512');
  const { sha1 } = require('@noble/hashes/sha1');
  const digests: Record<string, (data: Uint8Array) => Uint8Array> = {
    'SHA-1': sha1,
    'SHA-256': sha256,
    'SHA-384': sha384,
    'SHA-512': sha512,
  };
  g.crypto.subtle = {
    async digest(algorithm: string | { name: string }, data: ArrayBuffer | ArrayBufferView) {
      const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
      const fn = digests[name];
      if (!fn) throw new Error(`crypto.subtle.digest: unsupported algorithm ${name}`);
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const out = fn(bytes);
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    },
  };
}

// --- localStorage (waku peer cache + debug logger config) ---
if (typeof g.localStorage === 'undefined') {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}
// Uncomment to surface waku/libp2p logs in Metro output while debugging:
// g.localStorage.setItem('debug', 'waku:*error*,libp2p:websockets*,libp2p:dial*');

// --- Event / EventTarget / CustomEvent (libp2p TypedEventEmitter) ---
if (typeof g.Event === 'undefined' || typeof g.EventTarget === 'undefined') {
  const shim = require('event-target-shim');
  if (typeof g.Event === 'undefined') g.Event = shim.Event;
  if (typeof g.EventTarget === 'undefined') g.EventTarget = shim.EventTarget;
}
if (typeof g.CustomEvent === 'undefined') {
  class CustomEvent extends g.Event {
    detail: unknown;
    constructor(type: string, params: any = {}) {
      super(type, params);
      this.detail = params.detail;
    }
  }
  g.CustomEvent = CustomEvent;
}

// --- AbortSignal instance methods (libp2p job queues) ---
if (typeof g.AbortSignal !== 'undefined') {
  const signalProto = g.AbortSignal.prototype;

  // RN's AbortController polyfill may ignore abort(reason) — detect and patch.
  const probe = new AbortController();
  probe.abort('__probe__');
  if ((probe.signal as any).reason !== '__probe__') {
    if (!('reason' in signalProto)) {
      Object.defineProperty(signalProto, 'reason', {
        configurable: true,
        get() {
          return this.__polyfillAbortReason;
        },
      });
    }
    const originalAbort = g.AbortController.prototype.abort;
    g.AbortController.prototype.abort = function abort(reason?: unknown) {
      if (this.signal.__polyfillAbortReason === undefined) {
        this.signal.__polyfillAbortReason =
          reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      }
      return originalAbort.call(this);
    };
  }

  if (typeof signalProto.throwIfAborted !== 'function') {
    signalProto.throwIfAborted = function throwIfAborted() {
      if (this.aborted) {
        throw (
          this.reason ??
          Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
        );
      }
    };
  }
}

// --- AbortSignal statics (libp2p timeouts) ---
if (typeof g.AbortSignal !== 'undefined') {
  if (typeof g.AbortSignal.timeout !== 'function') {
    g.AbortSignal.timeout = (ms: number) => {
      const controller = new AbortController();
      const err = new Error(`Signal timed out after ${ms}ms`);
      err.name = 'TimeoutError';
      setTimeout(() => controller.abort(err), ms);
      return controller.signal;
    };
  }
  if (typeof g.AbortSignal.any !== 'function') {
    g.AbortSignal.any = (signals: AbortSignal[]) => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort((signal as any).reason);
          break;
        }
        signal.addEventListener('abort', () => controller.abort((signal as any).reason), {
          once: true,
        });
      }
      return controller.signal;
    };
  }
}

// --- Promise.withResolvers (ES2024, used by newer libp2p internals) ---
if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
