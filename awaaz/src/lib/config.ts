/**
 * Where the Awaaz hub (speech service + local nwaku node) lives.
 * The iOS Simulator shares the Mac's network, so localhost reaches it.
 * On a physical phone, set this to the Mac's Wi-Fi IP (see Settings).
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// The Android emulator reaches the host Mac at 10.0.2.2; the iOS Simulator
// shares the Mac's network. Real phones must be pointed at the Mac's Wi-Fi IP.
export const DEFAULT_HUB_HOST = Platform.OS === 'android' && !Device.isDevice ? '10.0.2.2' : 'localhost';
export const HUB_HTTP_PORT = 8787;

export const MAX_VOICE_SEC = 20;
export const DEFAULT_CHECKIN_BY = '11:00';

export const QUICK_TAGS = [
  { key: 'medicine', label: 'Medicine taken', emoji: '💊' },
  { key: 'meal', label: 'Ate', emoji: '🍲' },
  { key: 'walk', label: 'Walked', emoji: '🚶' },
  { key: 'unwell', label: 'Not feeling well', emoji: '🤒' },
] as const;

export type TagKey = (typeof QUICK_TAGS)[number]['key'];

export function familyTopic(familyId: string): string {
  return `/awaaz/1/fam-${familyId}/json`;
}
