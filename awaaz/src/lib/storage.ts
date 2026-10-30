import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_HUB_HOST } from '@/lib/config';
import { newIdentity, type Identity } from '@/lib/crypto';

export type Role = 'parent' | 'child';

export type Profile = {
  role: Role;
  name: string;
  familyKey: string;
};

const K = {
  identity: 'awaaz.identity',
  profile: 'awaaz.profile',
  hubHost: 'awaaz.hubHost',
  messages: (fid: string) => `awaaz.fam.${fid}.messages`,
  outbox: (fid: string) => `awaaz.fam.${fid}.outbox`,
  transcripts: 'awaaz.transcripts',
};

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function setJson(key: string, value: unknown): Promise<void> {
  return AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadIdentity(): Promise<Identity> {
  const existing = await getJson<Identity | null>(K.identity, null);
  if (existing) return existing;
  const id = newIdentity();
  await setJson(K.identity, id);
  return id;
}

export const loadProfile = () => getJson<Profile | null>(K.profile, null);
export const saveProfile = (p: Profile) => setJson(K.profile, p);
export const clearProfile = () => AsyncStorage.removeItem(K.profile);

export const loadHubHost = () => getJson<string>(K.hubHost, DEFAULT_HUB_HOST);
export const saveHubHost = (h: string) => setJson(K.hubHost, h);

export const loadMessages = <T>(fid: string) => getJson<T[]>(K.messages(fid), []);
export const saveMessages = <T>(fid: string, msgs: T[]) => setJson(K.messages(fid), msgs);

export const loadOutbox = <T>(fid: string) => getJson<T[]>(K.outbox(fid), []);
export const saveOutbox = <T>(fid: string, msgs: T[]) => setJson(K.outbox(fid), msgs);

export const loadTranscripts = () => getJson<Record<string, string>>(K.transcripts, {});
export const saveTranscripts = (t: Record<string, string>) => setJson(K.transcripts, t);

export async function clearFamilyData(fid: string): Promise<void> {
  await AsyncStorage.multiRemove([K.messages(fid), K.outbox(fid), K.profile]);
}
