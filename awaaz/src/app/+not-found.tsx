import * as Linking from 'expo-linking';
import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router';
import { Text, View } from 'react-native';

import { C } from '@/components/awaaz/ui';

/**
 * Room invites (awaaz://room/<key>) and family links (awaaz://family/<key>)
 * arrive with "room"/"family" parsed as the URL host, leaving an unmatched
 * "/<key>" path. Recover them here.
 */
export default function NotFound() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ role?: string; name?: string; n?: string; m?: string }>();
  const url = Linking.useURL() ?? '';

  const key = (pathname.match(/[0-9a-fA-F]{64}/) ?? url.match(/[0-9a-fA-F]{64}/))?.[0];
  // Room invites: awaaz://room/<key>?n=<name>&m=<moderator key>
  if (key && /:\/\/room\//.test(url)) {
    const q = new URLSearchParams();
    if (params.n) q.set('n', String(params.n));
    if (params.m) q.set('m', String(params.m));
    const qs = q.toString();
    return <Redirect href={`/join/${key}${qs ? `?${qs}` : ''}` as any} />;
  }
  if (key) {
    const q = new URLSearchParams();
    if (params.role) q.set('role', String(params.role));
    if (params.name) q.set('name', String(params.name));
    const qs = q.toString();
    return <Redirect href={`/family/${key}${qs ? `?${qs}` : ''}` as any} />;
  }
  if (pathname === '/' || pathname === '') return <Redirect href="/" />;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: C.text, fontSize: 18 }}>Page not found.</Text>
    </View>
  );
}
