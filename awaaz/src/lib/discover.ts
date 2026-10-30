/**
 * Finds the community hub on the local Wi-Fi or hotspot, so nobody has to type
 * an IP address. Needs no internet: it only talks to devices on the same
 * network. Order: the last hub that worked and the simulator/emulator
 * shortcuts, then every address on this phone's subnet, then the usual
 * hotspot subnets (for when the phone can't tell its own address).
 */
import { Platform } from 'react-native';

import { DEFAULT_HUB_HOST, HUB_HTTP_PORT } from '@/lib/config';
import { loadHubHost, saveHubHost } from '@/lib/storage';

const QUICK_PROBE_MS = 2000;
const SCAN_PROBE_MS = 900;
const CONCURRENCY = 96;

/** True if `host` answers like an Awaaz hub. */
export async function isHub(host: string, timeoutMs = QUICK_PROBE_MS, stop?: AbortSignal): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onStop = () => ctrl.abort();
  stop?.addEventListener('abort', onStop);
  try {
    const res = await fetch(`http://${host}:${HUB_HTTP_PORT}/health`, { signal: ctrl.signal });
    if (!res.ok) return false;
    const j = await res.json();
    return j?.service === 'awaaz-hub' || (j?.ok === true && 'stt' in j);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    stop?.removeEventListener('abort', onStop);
  }
}

/** Probe hosts with limited concurrency; resolve with the first hub found. */
async function firstHub(hosts: string[], timeoutMs: number): Promise<string | null> {
  const stop = new AbortController();
  let found: string | null = null;
  let next = 0;
  const worker = async () => {
    while (!found && next < hosts.length) {
      const host = hosts[next++];
      if ((await isHub(host, timeoutMs, stop.signal)) && !found) {
        found = host;
        stop.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hosts.length) }, worker));
  return found;
}

async function myIp(): Promise<string | null> {
  try {
    // Required lazily: builds made before the module was added must not crash.
    const Network = require('expo-network') as typeof import('expo-network');
    const ip = await Network.getIpAddressAsync();
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== '0.0.0.0' ? ip : null;
  } catch {
    return null;
  }
}

function subnet(base: string, from: number, to: number, skip: string | null): string[] {
  const hosts: string[] = [];
  for (let i = from; i <= to; i++) {
    const h = `${base}.${i}`;
    if (h !== skip) hosts.push(h);
  }
  return hosts;
}

/** Look for the hub; saves and returns its address, or null if none answered. */
export async function findHub(onScan?: () => void): Promise<string | null> {
  const saved = await loadHubHost();
  const shortcuts = [saved, DEFAULT_HUB_HOST, Platform.OS === 'android' ? '10.0.2.2' : 'localhost'];
  let hub = await firstHub([...new Set(shortcuts)], QUICK_PROBE_MS);

  if (!hub) {
    onScan?.();
    const ip = await myIp();
    const ranges: [string, number, number][] = [];
    if (ip) {
      // This phone's own block first, then its neighbours: campus and office
      // Wi-Fi is often one big /20 (4,000 addresses) where the hub laptop sits
      // in a different x.y.Z block. Nearest blocks are searched first.
      const [a, b, c] = ip.split('.').map(Number);
      const start = c - (c % 16);
      const blocks = Array.from({ length: 16 }, (_, i) => start + i).sort(
        (p, q) => Math.abs(p - c) - Math.abs(q - c)
      );
      for (const block of blocks) ranges.push([`${a}.${b}.${block}`, 1, 254]);
    }
    // Android and iPhone hotspots, in case the phone couldn't report its address.
    ranges.push(['192.168.43', 1, 254], ['172.20.10', 1, 14]);
    const seen = new Set<string>();
    for (const [base, from, to] of ranges) {
      if (seen.has(base)) continue;
      seen.add(base);
      hub = await firstHub(subnet(base, from, to, ip), SCAN_PROBE_MS);
      if (hub) break;
    }
  }

  if (hub) await saveHubHost(hub);
  return hub;
}
