import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Button, C } from '@/components/awaaz/ui';
import { parsePairCode } from '@/lib/crypto';
import { loadProfile, saveProfile, type Role } from '@/lib/storage';

/**
 * F1 via QR: the family QR is an awaaz://family/<key> link, so scanning it
 * with the phone camera opens the app here and joins the family.
 * ?role=parent|child&name=… skips the questions (handy for scripted tests).
 */
export default function JoinFamily() {
  const params = useLocalSearchParams<{ key: string; role?: Role; name?: string }>();
  const key = parsePairCode(params.key ?? '');
  const [status, setStatus] = useState<'checking' | 'choose' | 'already' | 'invalid'>('checking');

  const join = async (role: Role) => {
    await saveProfile({
      role,
      name: params.name || (role === 'parent' ? 'Amma' : 'Son'),
      familyKey: key!,
    });
    router.replace('/circle');
  };

  useEffect(() => {
    (async () => {
      if (!key) return setStatus('invalid');
      if (await loadProfile()) return setStatus('already');
      if (params.role === 'parent' || params.role === 'child') return join(params.role);
      setStatus('choose');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Join family</Text>
      {status === 'invalid' && <Text style={s.text}>This family link is not valid.</Text>}
      {status === 'already' && (
        <Text style={s.text}>This phone is already in a family. Leave it in Settings first.</Text>
      )}
      {status === 'choose' && (
        <>
          <Text style={s.text}>Who will use this phone?</Text>
          <Button label="👵  I am the parent" onPress={() => join('parent')} />
          <Button label="🧑  I am the son / daughter" kind="secondary" onPress={() => join('child')} />
        </>
      )}
      {status !== 'checking' && status !== 'choose' && (
        <Button label="Go home" kind="secondary" onPress={() => router.replace('/circle')} />
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 80, gap: 14 },
  title: { color: C.coral, fontSize: 32, fontWeight: '800' },
  text: { color: C.text, fontSize: 17 },
});
