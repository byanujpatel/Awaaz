import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { router } from 'expo-router';

import { Button, C } from '@/components/awaaz/ui';
import { pairCode } from '@/lib/crypto';
import type { Profile } from '@/lib/storage';

export function Settings({
  profile,
  hubHost,
  onHubHost,
  onClose,
  onReset,
}: {
  profile: Profile;
  hubHost: string;
  onHubHost: (h: string) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const [host, setHost] = useState(hubHost);
  const code = pairCode(profile.familyKey);
  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Settings</Text>

      <Text style={s.label}>Family code — scan or paste on another phone to add it</Text>
      <View style={s.qr}>
        <QRCode value={code} size={180} />
      </View>
      <Button label="Copy family code" kind="secondary" onPress={() => Clipboard.setStringAsync(code)} />

      <Text style={s.label}>Hub address (Mac running nwaku + speech)</Text>
      <TextInput
        style={s.input}
        value={host}
        onChangeText={setHost}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={s.hint}>Simulator: localhost. Phone on Wi-Fi: the Mac's IP, e.g. 192.168.1.20. Restart the app after changing.</Text>
      <Button label="Save hub address" kind="secondary" onPress={() => onHubHost(host.trim())} />

      <Button label="Back" onPress={onClose} />
      <Button label="‹ Awaaz home (rooms)" kind="secondary" onPress={() => router.replace('/')} />
      <Button label="Leave family and delete history on this phone" kind="danger" onPress={onReset} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 70, gap: 12 },
  title: { color: C.text, fontSize: 26, fontWeight: '700' },
  label: { color: C.text, fontSize: 15, fontWeight: '600', marginTop: 10 },
  qr: { alignSelf: 'center', padding: 14, backgroundColor: '#fff', borderRadius: 14 },
  input: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 12, color: C.text, padding: 12, fontSize: 16 },
  hint: { color: C.textDim, fontSize: 13 },
});
