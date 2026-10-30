import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C } from '@/components/awaaz/ui';

/** The threat model in plain words: what Awaaz protects today, and what it doesn't yet. */
const PROTECTED = [
  ['🙈', 'No account, phone number or name. Each room gives you a throwaway identity you can reset any time.'],
  ['🎙️', 'Your recording is turned into text on the hub, then deleted. Only text is ever posted.'],
  ['🛡️', 'AI rewrites names and personal details, a rule-based check runs after it, and you approve the final text. Posting is blocked if a phone number or email is still in it.'],
  ['🔒', 'Posts are encrypted with the room key. Logos nodes only relay and store ciphertext on a hashed topic.'],
  ['✍️', 'Every message is signed, and only the room host can mark an issue as handled or fixed.'],
  ['🧹', 'One tap deletes every room, name and message from this phone.'],
];

const NOT_YET = [
  ['💻', 'The hub laptop hears your voice and sees your phone’s network address while it makes the text. Only use a hub run by someone you trust.'],
  ['📡', 'Other Logos nodes can see your phone’s network address. Awaaz doesn’t hide it yet.'],
  ['🔑', 'Anyone with the invite link can read the room. Public rooms can be read by anyone on the same hub.'],
  ['🙋', 'One person can add extra “me too”s by changing their anonymous name.'],
  ['🕒', 'Old posts last only as long as the community’s storage node keeps them.'],
  ['🧠', 'The AI can miss things, and the details of your story can still point to you. Read before you post.'],
];

export default function Safety() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: C.bg }}
      contentContainerStyle={[s.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <Text style={s.title}>How you’re protected</Text>
      </View>

      <Text style={[s.section, { color: C.success }]}>Protected</Text>
      <List items={PROTECTED} />

      <Text style={[s.section, { color: C.warning }]}>Not protected yet</Text>
      <List items={NOT_YET} />
    </ScrollView>
  );
}

function List({ items }: { items: string[][] }) {
  return (
    <View style={s.card}>
      {items.map(([icon, text]) => (
        <View key={text} style={s.item}>
          <Text style={s.icon}>{icon}</Text>
          <Text style={s.text}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  back: { color: C.text, fontSize: 34, lineHeight: 36 },
  title: { color: C.text, fontSize: 26, fontWeight: '800', flexShrink: 1 },
  section: { fontSize: 13, fontWeight: '700', marginTop: 12, textTransform: 'uppercase', letterSpacing: 1 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 14 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { fontSize: 20, width: 28 },
  text: { color: C.text, fontSize: 15, lineHeight: 21, flex: 1 },
});
