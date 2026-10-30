import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, C } from '@/components/awaaz/ui';
import { newFamilyKey, pairCode, parsePairCode } from '@/lib/crypto';
import type { Profile, Role } from '@/lib/storage';

/** F1: no accounts — a family is just a shared key, passed by QR or code. */
export function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [key] = useState(newFamilyKey);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!role) {
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.title}>Awaaz</Text>
        <Text style={s.sub}>Daily check-ins between parents and children, over Logos messaging.</Text>
        <Text style={s.q}>Who will use this phone?</Text>
        <Button label="👵  I am the parent" onPress={() => setRole('parent')} />
        <Button label="🧑  I am the son / daughter" kind="secondary" onPress={() => setRole('child')} />
      </ScrollView>
    );
  }

  const finish = (familyKey: string) => onDone({ role, name: name.trim() || defaultName(role), familyKey });

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.q}>Your name (shown to family)</Text>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        placeholder={defaultName(role)}
        placeholderTextColor={C.textDim}
      />

      {mode === 'choose' && (
        <>
          <Text style={s.q}>Pair with your family</Text>
          <Button label="Create a new family" onPress={() => setMode('create')} />
          <Button label="Join with a family code" kind="secondary" onPress={() => setMode('join')} />
        </>
      )}

      {mode === 'create' && (
        <>
          <Text style={s.q}>Show this to the other phone</Text>
          <View style={s.qr}>
            <QRCode value={pairCode(key)} size={220} />
          </View>
          <Text style={s.code} selectable>
            {pairCode(key)}
          </Text>
          <Button label="Copy code" kind="secondary" onPress={() => Clipboard.setStringAsync(pairCode(key))} />
          <Button label="Done — continue" onPress={() => finish(key)} />
        </>
      )}

      {mode === 'join' && (
        <>
          <Text style={s.q}>Paste the family code</Text>
          <TextInput
            style={[s.input, { minHeight: 80 }]}
            value={code}
            onChangeText={(t) => {
              setCode(t);
              setError(null);
            }}
            placeholder="awaaz://family/…"
            placeholderTextColor={C.textDim}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            label="Paste from clipboard"
            kind="secondary"
            onPress={async () => setCode(await Clipboard.getStringAsync())}
          />
          {error && <Text style={s.err}>{error}</Text>}
          <Button
            label="Join family"
            onPress={() => {
              const k = parsePairCode(code);
              if (!k) setError('That code does not look right.');
              else finish(k);
            }}
          />
        </>
      )}
    </ScrollView>
  );
}

function defaultName(role: Role) {
  return role === 'parent' ? 'Amma' : 'Son';
}

const s = StyleSheet.create({
  wrap: { padding: 24, gap: 14, paddingTop: 80 },
  title: { color: C.coral, fontSize: 40, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 16, marginBottom: 24 },
  q: { color: C.text, fontSize: 18, fontWeight: '600', marginTop: 12 },
  input: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    color: C.text,
    padding: 14,
    fontSize: 16,
  },
  qr: { alignSelf: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 16 },
  code: { color: C.textDim, fontSize: 12, textAlign: 'center' },
  err: { color: C.error },
});
