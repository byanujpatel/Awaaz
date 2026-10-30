import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C, TapToSpeak } from '@/components/awaaz/ui';
import { fileToBase64 } from '@/lib/audio';
import {
  anonymise,
  CATEGORIES,
  handleFor,
  inviteLink,
  leftoverIdentifiers,
  useRoom,
  wordsToCheck,
  type FeedItem,
  type GuardResult,
  type PostStatus,
  type Room,
} from '@/lib/rooms';

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS: Record<PostStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: C.warning },
  acknowledged: { label: 'Being handled', color: '#63B3ED' },
  resolved: { label: 'Fixed', color: C.success },
};

type Draft = {
  kind: 'voice' | 'text';
  result: GuardResult | null;
  text: string;
  error?: string;
  /** The poster has read the final text and confirmed it identifies nobody. */
  checked?: boolean;
  showOriginal?: boolean;
};

export function RoomScreen({
  room,
  hubHost,
  onResetIdentity,
  onLeave,
}: {
  room: Room;
  hubHost: string;
  onResetIdentity: () => void;
  onLeave: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { feed, pending, net, send, setStatus, isModerator, me } = useRoom(room, hubHost);
  const [typed, setTyped] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copied, setCopied] = useState(false);
  const [typing, setTyping] = useState(false);
  const myName = handleFor(me.pub);

  // While the keyboard is up, the big mic steps aside so the feed stays visible.
  useEffect(() => {
    // Android only emits the "Did" keyboard events.
    const [showEvt, hideEvt] =
      Platform.OS === 'ios' ? ['keyboardWillShow', 'keyboardWillHide'] : ['keyboardDidShow', 'keyboardDidHide'];
    const show = Keyboard.addListener(showEvt as 'keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener(hideEvt as 'keyboardDidHide', () => setTyping(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const fromVoice = async (uri: string) => {
    setDraft({ kind: 'voice', result: null, text: '' });
    try {
      const audio = await fileToBase64(uri);
      const result = await anonymise(hubHost, { audio });
      if (!result.original.trim()) {
        // Nothing was heard: usually a muted mic or no microphone permission.
        setDraft({
          kind: 'voice',
          result: null,
          text: '',
          error:
            "We couldn't hear anything in that recording. Check the microphone is allowed and not muted, then speak a little closer.",
        });
        return;
      }
      setDraft({ kind: 'voice', result, text: result.text });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'AbortError';
      setDraft({
        kind: 'voice',
        result: null,
        text: '',
        error: timedOut
          ? 'The community hub took too long to turn your voice into text. Try a shorter message, or type instead.'
          : `Couldn't reach the community hub at ${hubHost}. Your voice is never sent as audio, so type instead.`,
      });
    }
  };

  const fromText = async () => {
    const t = typed.trim();
    if (!t) return;
    Keyboard.dismiss();
    setDraft({ kind: 'text', result: null, text: '' });
    const result = await anonymise(hubHost, { text: t });
    setDraft({ kind: 'text', result, text: result.text });
  };

  // Re-checked on every edit: the guard ran on the hub's version, not on what the poster typed after.
  const leftovers = draft?.result ? leftoverIdentifiers(draft.text) : [];
  const toCheck = draft?.result ? wordsToCheck(draft.result.original, draft.text) : [];
  const canPost = !!draft?.result && !!draft.text.trim() && !!draft.checked && leftovers.length === 0;

  const post = async () => {
    if (!draft?.result || !canPost) return;
    await send({
      type: 'post',
      text: draft.text.trim(),
      category: draft.result.category,
      kind: draft.kind,
      removed: draft.result.removed.length,
    });
    setDraft(null);
    setTyped('');
  };

  const menu = () =>
    Alert.alert(room.name, `You're anonymous here as ${myName}.`, [
      { text: 'How you are protected', onPress: () => router.push('/safety' as any) },
      { text: 'New anonymous name', onPress: onResetIdentity },
      { text: 'Leave room', style: 'destructive', onPress: onLeave },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const invite = async () => {
    const link = inviteLink(room);
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    Share.share({ message: `Join "${room.name}" on Awaaz, anonymous: ${link}` }).catch(() => {});
  };

  return (
    // Android 15+ draws edge-to-edge, so the window no longer resizes for the
    // keyboard: pad on both platforms.
    <KeyboardAvoidingView style={s.screen} behavior="padding">
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Text style={s.back}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>
            {room.name}
          </Text>
          <Text style={s.live}>
            <Text style={{ color: net === 'online' ? C.success : C.warning }}>● </Text>
            {net === 'online'
              ? `Live · you're ${myName}`
              : pending > 0
                ? `Offline · ${pending} waiting to send`
                : 'Connecting…'}
          </Text>
        </View>
        <Pressable onPress={invite} style={s.invite} hitSlop={6}>
          <Text style={s.inviteText}>{copied ? '✓ Copied' : 'Invite'}</Text>
        </Pressable>
        <Pressable onPress={menu} style={s.more} hitSlop={8} accessibilityLabel="Room options">
          <Text style={s.moreText}>⋯</Text>
        </Pressable>
      </View>

      <FlatList
        data={feed}
        keyExtractor={(p) => p.id}
        contentContainerStyle={s.feed}
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            <Text style={s.emptyIcon}>🎙️</Text>
            <Text style={s.emptyTitle}>Be the first to speak up</Text>
            <Text style={s.empty}>Tap the mic and say what's wrong. Names are removed before anyone sees it.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            p={item}
            onMeToo={() => send({ type: 'metoo', postId: item.id })}
            onStatus={isModerator ? (status) => setStatus(item.id, status) : undefined}
          />
        )}
      />

      <View style={[s.composer, { paddingBottom: insets.bottom + 12 }]}>
        {!typing && (
          <TapToSpeak
            size={96}
            idleLabel="Speak"
            doneLabel="Done"
            hint="Your voice turns into text, then it's deleted"
            onRecorded={fromVoice}
          />
        )}
        <View style={s.typeRow}>
          <TextInput
            style={s.typeInput}
            value={typed}
            onChangeText={setTyped}
            placeholder="Or type here…"
            placeholderTextColor={C.textDim}
            multiline
          />
          <Pressable onPress={fromText} style={[s.sendBtn, !typed.trim() && { opacity: 0.4 }]} disabled={!typed.trim()}>
            <Text style={s.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView style={s.sheetBackdrop} behavior="padding">
          <View style={s.sheet}>
            {draft && !draft.result && !draft.error && (
              <View style={s.working}>
                <ActivityIndicator color={C.coral} size="large" />
                <Text style={s.workingText}>
                  {draft.kind === 'voice' ? 'Turning your voice into text…\n' : ''}Removing anything that could identify you…
                </Text>
              </View>
            )}
            {draft?.error && (
              <>
                <Text style={s.sheetTitle}>Voice not posted</Text>
                <Text style={s.sheetBody}>{draft.error}</Text>
                <Button label="OK" kind="secondary" onPress={() => setDraft(null)} />
              </>
            )}
            {draft?.result && (
              <>
                <Text style={s.sheetTitle}>This is what everyone will see</Text>
                <TextInput
                  style={s.preview}
                  value={draft.text}
                  onChangeText={(t) => setDraft({ ...draft, text: t, checked: false })}
                  multiline
                  // Return closes the keyboard so the checks and Post button below are visible again.
                  submitBehavior="blurAndSubmit"
                  returnKeyType="done"
                />
                <Text style={s.chip}>
                  {CATEGORIES[draft.result.category].emoji} {CATEGORIES[draft.result.category].label} · posting as {myName}
                </Text>
                {draft.result.removed.length > 0 && (
                  <View style={s.removed}>
                    <Text style={s.removedTitle}>🛡️ Removed to protect you</Text>
                    {draft.result.removed.map((r, i) => (
                      <Text key={i} style={s.removedItem}>
                        • {r}
                      </Text>
                    ))}
                  </View>
                )}
                {leftovers.length > 0 && (
                  <Text style={s.block}>⛔ Your text still has {leftovers.join(' and ')}. Remove it to post.</Text>
                )}
                {toCheck.length > 0 && (
                  <Text style={s.warn}>
                    🔎 Double-check these words, they could be a name: {toCheck.join(', ')}. Keep them only if they’re a
                    shared place or thing.
                  </Text>
                )}
                {!!draft.result.original && draft.result.original !== draft.text && (
                  <Pressable onPress={() => setDraft({ ...draft, showOriginal: !draft.showOriginal })} hitSlop={6}>
                    <Text style={s.link}>{draft.showOriginal ? 'Hide what you said' : 'Compare with what you said'}</Text>
                    {draft.showOriginal && <Text style={s.original}>{draft.result.original}</Text>}
                  </Pressable>
                )}
                {draft.kind === 'voice' && <Text style={s.note}>🎙️ Your recording has been deleted. Only this text is posted.</Text>}
                {(draft.result.guard === 'device' || draft.result.guard === 'regex') && (
                  <Text style={s.warn}>
                    ⚠️ The AI check didn't run, so only numbers, emails and obvious names were removed. Read it
                    carefully and delete anything that could identify you or someone else.
                  </Text>
                )}
                {draft.result.personalAttack && (
                  <Text style={s.warn}>This reads like an attack on one person. Speak about the issue, not the individual.</Text>
                )}
                <Pressable
                  onPress={() => setDraft({ ...draft, checked: !draft.checked })}
                  style={s.confirm}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!draft.checked }}>
                  <View style={[s.box, draft.checked && s.boxOn]}>{draft.checked && <Text style={s.tick}>✓</Text>}</View>
                  <Text style={s.confirmText}>I’ve read it. It doesn’t identify me or anyone else.</Text>
                </Pressable>
                <Button
                  label={draft.result.personalAttack ? 'Post anyway' : 'Post anonymously'}
                  onPress={post}
                  disabled={!canPost}
                />
                <Button label="Cancel" kind="secondary" onPress={() => setDraft(null)} />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function PostCard({
  p,
  onMeToo,
  onStatus,
}: {
  p: FeedItem;
  onMeToo: () => void;
  /** Only on the room creator's phone. */
  onStatus?: (s: PostStatus) => void;
}) {
  const cat = CATEGORIES[p.category] ?? CATEGORIES.other;
  const st = STATUS[p.status];
  const update = () =>
    Alert.alert('Update this issue', p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text, [
      { text: 'Being handled', onPress: () => onStatus?.('acknowledged') },
      { text: 'Fixed', onPress: () => onStatus?.('resolved') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  return (
    <View style={[s.card, p.status === 'resolved' && { opacity: 0.6 }]}>
      {p.status !== 'open' && (
        <Text style={[s.status, { color: st.color, borderColor: st.color }]}>
          {p.status === 'resolved' ? '✓ ' : ''}
          {st.label}
        </Text>
      )}
      <Text style={s.cardText}>{p.text}</Text>
      <Text style={s.meta}>
        {cat.emoji} {cat.label} · {p.mine ? 'You' : handleFor(p.from)} · {ago(p.at)}
        {p.removed > 0 ? ' · 🛡️ protected' : ''}
      </Text>
      <View style={s.actions}>
        {p.mine ? (
          <Text style={s.agree}>
            {p.meToo > 0 ? `🙋 ${p.meToo} ${p.meToo === 1 ? 'person agrees' : 'people agree'}` : 'Your post'}
          </Text>
        ) : (
          <Pressable onPress={onMeToo} disabled={p.iMeToo} style={[s.metoo, p.iMeToo && s.metooOn]}>
            <Text style={s.metooText}>
              🙋 {p.iMeToo ? 'You too' : 'Me too'}
              {p.meToo > 0 ? ` · ${p.meToo}` : ''}
            </Text>
          </Pressable>
        )}
        {onStatus && p.status !== 'resolved' && (
          <Pressable onPress={update} hitSlop={10} style={s.cardMore} accessibilityLabel="Update this issue">
            <Text style={s.moreText}>⋯</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomColor: C.border, borderBottomWidth: 1 },
  live: { color: C.textDim, fontSize: 13, marginTop: 2 },
  more: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  moreText: { color: C.text, fontSize: 22, lineHeight: 24, fontWeight: '700' },
  back: { color: C.text, fontSize: 34, lineHeight: 36 },
  title: { color: C.text, fontSize: 22, fontWeight: '800' },
  invite: { backgroundColor: C.coral, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14 },
  inviteText: { color: C.onCoral, fontWeight: '800', fontSize: 15 },
  feed: { padding: 16, gap: 12, paddingBottom: 8 },
  emptyWrap: { alignItems: 'center', marginTop: 48, gap: 8, paddingHorizontal: 24 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { color: C.text, fontSize: 19, fontWeight: '700' },
  empty: { color: C.textDim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  card: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  status: {
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  cardText: { color: C.text, fontSize: 18, lineHeight: 26 },
  meta: { color: C.textDim, fontSize: 13 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metoo: { backgroundColor: C.surfaceHigh, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  metooOn: { backgroundColor: '#3A2A1F' },
  metooText: { color: C.text, fontSize: 15, fontWeight: '700' },
  agree: { color: C.textDim, fontSize: 14, fontWeight: '600', paddingVertical: 10 },
  cardMore: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  composer: { borderTopColor: C.border, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 4, gap: 6 },
  typeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  typeInput: {
    flex: 1,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    color: C.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 110,
  },
  sendBtn: { backgroundColor: C.coral, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: C.onCoral, fontSize: 22, fontWeight: '900' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 12, borderColor: C.border, borderWidth: 1 },
  working: { alignItems: 'center', gap: 14, paddingVertical: 30 },
  workingText: { color: C.text, fontSize: 16, textAlign: 'center', lineHeight: 24 },
  sheetTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  sheetBody: { color: C.textDim, fontSize: 15, lineHeight: 22 },
  preview: { backgroundColor: C.surface, borderColor: C.coral, borderWidth: 1, borderRadius: 14, color: C.text, padding: 14, fontSize: 17, lineHeight: 24, minHeight: 90 },
  chip: { color: C.textDim, fontSize: 14 },
  removed: { backgroundColor: '#15261D', borderRadius: 12, padding: 12, gap: 4 },
  removedTitle: { color: C.success, fontWeight: '800', fontSize: 14 },
  removedItem: { color: C.text, fontSize: 14 },
  note: { color: C.textDim, fontSize: 13 },
  warn: { color: C.warning, fontSize: 14, lineHeight: 20 },
  block: { color: C.error, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  link: { color: C.coral, fontSize: 14, fontWeight: '700' },
  original: { color: C.textDim, fontSize: 14, lineHeight: 20, marginTop: 6 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.textDim, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.coral, borderColor: C.coral },
  tick: { color: C.onCoral, fontWeight: '900', fontSize: 15 },
  confirmText: { color: C.text, fontSize: 15, flex: 1 },
});
