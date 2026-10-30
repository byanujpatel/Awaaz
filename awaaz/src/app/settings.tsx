import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C } from '@/components/awaaz/ui';
import { findHub, isHub } from '@/lib/discover';
import { wipeEverything } from '@/lib/rooms';
import { loadHubHost, saveHubHost } from '@/lib/storage';

const PROMISES = [
  ['🙈', 'No account, no phone number, no name'],
  ['🎙️', 'Your voice becomes text, then the recording is deleted'],
  ['🛡️', 'AI removes names and personal details before anyone sees it'],
  ['🧠', 'The AI runs locally on the hub laptop: no cloud, no API calls'],
  ['🔒', 'Posts are encrypted; only people in the room can read them'],
  ['📡', 'Runs on Logos: no company server'],
];

export default function Settings() {
  const insets = useSafeAreaInsets();
  const [hub, setHub] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadHubHost().then(setHub);
  }, []);

  const findAgain = async () => {
    setBusy(true);
    const found = await findHub();
    setBusy(false);
    if (found) {
      setHub(found);
      Alert.alert('Hub found', `Connected to the hub at ${found}.`);
    } else {
      Alert.alert('No hub found', 'Join the same Wi-Fi or hotspot as the hub laptop, then try again.');
    }
  };

  const saveManual = async () => {
    const host = hub.trim();
    if (!host) return;
    setBusy(true);
    const ok = await isHub(host, 3000);
    setBusy(false);
    if (!ok) {
      Alert.alert('No hub there', `Nothing answered at ${host}. Check the address and the Wi-Fi.`);
      return;
    }
    await saveHubHost(host);
    Alert.alert('Saved', `Connected to the hub at ${host}.`);
  };

  const panic = () =>
    Alert.alert(
      'Delete everything?',
      'Removes every room, your anonymous names, family data and all history from this phone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await wipeEverything();
            router.dismissAll();
          },
        },
      ]
    );

  return (
    <ScrollView
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={[s.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}
      keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <Text style={s.title}>Settings</Text>
      </View>

      <Text style={s.section}>How you stay anonymous</Text>
      <View style={s.card}>
        {PROMISES.map(([icon, text]) => (
          <View key={text} style={s.promise}>
            <Text style={s.promiseIcon}>{icon}</Text>
            <Text style={s.promiseText}>{text}</Text>
          </View>
        ))}
        <Pressable onPress={() => router.push('/safety' as any)} hitSlop={6}>
          <Text style={s.link}>What’s protected, and what isn’t yet ›</Text>
        </Pressable>
      </View>

      <Text style={s.section}>Community hub</Text>
      <View style={s.card}>
        <Text style={s.body}>
          The laptop that turns voice into text and removes names, with AI running on it locally. Phones find it
          on the same Wi-Fi or hotspot.
        </Text>
        <TextInput
          style={s.input}
          value={hub}
          onChangeText={setHub}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          placeholder="e.g. 192.168.1.20"
          placeholderTextColor={C.textDim}
        />
        {busy ? (
          <ActivityIndicator color={C.coral} style={{ marginVertical: 10 }} />
        ) : (
          <View style={{ gap: 10 }}>
            <Button label="Find hub automatically" onPress={findAgain} />
            <Button label="Save this address" kind="secondary" onPress={saveManual} />
          </View>
        )}
      </View>

      <Text style={s.section}>Private circle</Text>
      <Pressable onPress={() => router.push('/circle')} style={({ pressed }) => [s.card, s.row, pressed && { opacity: 0.75 }]}>
        <Text style={s.rowIcon}>👪</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>Family check-ins</Text>
          <Text style={s.body}>Encrypted voice between parents and children</Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </Pressable>

      <View style={{ marginTop: 18 }}>
        <Button label="Delete everything on this phone" kind="danger" onPress={panic} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  back: { color: C.text, fontSize: 34, lineHeight: 36 },
  title: { color: C.text, fontSize: 28, fontWeight: '800' },
  section: { color: C.textDim, fontSize: 13, fontWeight: '700', marginTop: 12, textTransform: 'uppercase', letterSpacing: 1 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12 },
  promise: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  promiseIcon: { fontSize: 20, width: 28 },
  promiseText: { color: C.text, fontSize: 15, lineHeight: 21, flex: 1 },
  body: { color: C.textDim, fontSize: 14, lineHeight: 20 },
  link: { color: C.coral, fontSize: 15, fontWeight: '700' },
  input: {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    color: C.text,
    padding: 14,
    fontSize: 17,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { fontSize: 26 },
  rowTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  chevron: { color: C.textDim, fontSize: 30, lineHeight: 30 },
});
