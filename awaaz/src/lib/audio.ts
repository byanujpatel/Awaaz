import { fromByteArray, toByteArray } from 'base64-js';
import { AudioQuality, IOSOutputFormat, type RecordingOptions } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { QUICK_TAGS, type TagKey } from '@/lib/config';
import { hubBaseUrl } from '@/lib/transport';

/** Speech-sized AAC: mono 16 kHz at 24 kbps, ~60 KB for 20 s. */
export const VOICE_PRESET: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 24000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 24000 },
};

export async function fileToBase64(uri: string): Promise<string> {
  return fromByteArray(await new File(uri).bytes());
}

/** Writes a received clip to the cache (once) and returns its uri. */
export function base64ToCachedFile(id: string, b64: string): string {
  const file = new File(Paths.cache, `voice-${id}.m4a`);
  if (!file.exists) file.write(toByteArray(b64));
  return file.uri;
}

export type VoiceAnalysis = { text: string; tags: TagKey[] };

/**
 * Parent side, before sending: Parakeet transcript + Qwen-picked tags.
 * Times out so a slow or missing hub never blocks a voice message.
 */
export async function analyzeVoice(
  hubHost: string,
  audioBase64: string,
  timeoutMs = 15_000
): Promise<VoiceAnalysis> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${hubBaseUrl(hubHost)}/voice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64, ext: '.m4a' }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`voice ${res.status}`);
    const j = (await res.json()) as { text: string; tags: string[] };
    const known = QUICK_TAGS.map((t) => t.key) as string[];
    return { text: j.text, tags: j.tags.filter((t) => known.includes(t)) as TagKey[] };
  } finally {
    clearTimeout(timer);
  }
}

export type ModelState = 'ready' | 'loading' | 'offline';

/** Whether the hub's speech model is loaded (shown as a chip on the parent screen). */
export async function speechState(hubHost: string): Promise<ModelState> {
  try {
    const res = await fetch(`${hubBaseUrl(hubHost)}/health`);
    const j = (await res.json()) as { stt?: { state?: string } };
    return j.stt?.state === 'ready' ? 'ready' : 'loading';
  } catch {
    return 'offline';
  }
}

/**
 * English speech-to-text on the Mac hub (Parakeet). Sends base64 JSON:
 * Expo's fetch doesn't support React Native's {uri,name,type} form parts.
 */
export async function transcribe(hubHost: string, audioBase64: string): Promise<string> {
  const res = await fetch(`${hubBaseUrl(hubHost)}/transcribe-b64`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, ext: '.m4a' }),
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}`);
  return ((await res.json()) as { text: string }).text;
}
