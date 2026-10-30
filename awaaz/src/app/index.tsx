import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C } from '@/components/awaaz/ui';
import { findHub, isHub } from '@/lib/discover';
import { announceRoom, useLobby } from '@/lib/lobby';
import { createRoom, handleFor, joinRoom, loadRooms, parseInvite, roomId, type Room } from '@/lib/rooms';
import { loadHubHost } from '@/lib/storage';
import { onStatus, type NetStatus } from '@/lib/transport';

type HubState = 'finding' | 'scanning' | 'found' | 'missing';

/** Awaaz home: one list of rooms, one big button. Everything else is in ⚙︎. */
export default function Home() {
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [hub, setHub] = useState<string | null>(null);
  const [hubState, setHubState] = useState<HubState>('finding');
  const [net, setNet] = useState<NetStatus>('connecting');
  const [sheet, setSheet] = useState<'none' | 'create' | 'join'>('none');

  const hubRef = useRef<string | null>(null);
  hubRef.current = hub;
  const lobby = useLobby(hub);
  const joinedIds = new Set(rooms.map((r) => roomId(r.key)));
  const nearby = lobby.filter((a) => !joinedIds.has(a.id));

  const locate = useCallback(async () => {
    setHubState('finding');
    const found = await findHub(() => setHubState('scanning'));
    setHub(found);
    setHubState(found ? 'found' : 'missing');
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  // Wi-Fi may still be connecting when the app opens: keep looking by itself.
  useEffect(() => {
    if (hubState !== 'missing') return;
    const t = setTimeout(locate, 10_000);
    return () => clearTimeout(t);
  }, [hubState, locate]);

  useEffect(() => onStatus(setNet), []);

  useFocusEffect(
    useCallback(() => {
      loadRooms().then(setRooms);
      // The hub may have been found or changed in Settings.
      loadHubHost().then(async (saved) => {
        if (saved === hubRef.current || !(await isHub(saved))) return;
        setHub(saved);
        setHubState('found');
      });
    }, [])
  );

  // Keep my public rooms visible to people who arrive later.
  useEffect(() => {
    if (hub) rooms.filter((r) => r.isPublic).forEach((r) => announceRoom(hub, r, 1));
  }, [rooms, hub]);

  const open = (room: Room) => router.push(`/room/${roomId(room.key)}` as any);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.wrap, { paddingTop: insets.top + 16, paddingBottom: 24 }]}>
        <View style={s.headerRow}>
          <Text style={s.title}>Awaaz</Text>
          <Pressable onPress={() => router.push('/settings')} hitSlop={12} style={s.gear} accessibilityLabel="Settings">
            <Text style={s.gearText}>⚙︎</Text>
          </Pressable>
        </View>
        <Text style={s.tagline}>Speak up. Nobody knows it's you.</Text>

        <View style={s.steps}>
          <Step icon="🎙️" text="You speak" />
          <Text style={s.arrow}>→</Text>
          <Step icon="🛡️" text="Names removed" />
          <Text style={s.arrow}>→</Text>
          <Step icon="📡" text="Shared anonymously" />
        </View>

        {hubState !== 'found' && <HubCard state={hubState} onRetry={locate} />}

        {hubState === 'found' && (
          <>
            <Text style={s.section}>Rooms</Text>

            {rooms.length === 0 && nearby.length === 0 && (
              <View style={s.emptyCard}>
                <Text style={s.emptyIcon}>🗣️</Text>
                <Text style={s.emptyTitle}>No rooms yet</Text>
                <Text style={s.emptyText}>Start one for your hostel, office or society.</Text>
              </View>
            )}

            {rooms.map((r) => (
              <Pressable key={r.key} onPress={() => open(r)} style={({ pressed }) => [s.room, pressed && s.pressed]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.roomName} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={s.roomSub}>You're {handleFor(r.me.pub)}</Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            ))}

            {nearby.map((a) => (
              <Pressable
                key={a.id}
                onPress={async () => open(await joinRoom(a.key, a.name, true, a.owner))}
                style={({ pressed }) => [s.room, s.roomNew, pressed && s.pressed]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.roomName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={s.roomSub}>New room nearby</Text>
                </View>
                <Text style={s.joinPill}>Join</Text>
              </Pressable>
            ))}

            <Text style={s.footer}>
              <Text style={{ color: net === 'online' ? C.success : C.warning }}>●</Text>{' '}
              {net === 'online' ? 'Connected' : 'Connecting…'} · AI runs locally on your hub
            </Text>
          </>
        )}
      </ScrollView>

      {hubState === 'found' && (
        // Pinned, so the main action is always on screen however many rooms there are.
        <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
          <Button label="＋  Start a room" onPress={() => setSheet('create')} />
          <Pressable onPress={() => setSheet('join')} hitSlop={8} style={s.linkWrap}>
            <Text style={s.link}>Have an invite link?</Text>
          </Pressable>
        </View>
      )}

      <CreateSheet
        visible={sheet === 'create'}
        onClose={() => setSheet('none')}
        onCreate={async (name, isPublic) => {
          const room = await createRoom(name, isPublic);
          if (isPublic && hub) announceRoom(hub, room);
          setSheet('none');
          open(room);
        }}
      />
      <JoinSheet
        visible={sheet === 'join'}
        onClose={() => setSheet('none')}
        onJoin={async (key, name, owner) => {
          const room = await joinRoom(key, name, false, owner);
          setSheet('none');
          open(room);
        }}
      />
    </View>
  );
}

function Step({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={s.step}>
      <Text style={s.stepIcon}>{icon}</Text>
      <Text style={s.stepText}>{text}</Text>
    </View>
  );
}

function HubCard({ state, onRetry }: { state: HubState; onRetry: () => void }) {
  if (state === 'finding' || state === 'scanning') {
    return (
      <View style={s.hubCard}>
        <ActivityIndicator color={C.coral} />
        <Text style={s.hubTitle}>{state === 'finding' ? 'Connecting…' : 'Looking for your community hub…'}</Text>
        <Text style={s.hubText}>Searching this Wi-Fi for the hub laptop.</Text>
      </View>
    );
  }
  return (
    <View style={s.hubCard}>
      <Text style={s.hubIcon}>📶</Text>
      <Text style={s.hubTitle}>No hub found on this Wi-Fi</Text>
      <Text style={s.hubText}>
        Join the same Wi-Fi or hotspot as the hub laptop. Awaaz keeps looking by itself.
      </Text>
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 6 }}>
        <Button label="Try again" onPress={onRetry} />
        <Button label="Enter hub address" kind="secondary" onPress={() => router.push('/settings')} />
      </View>
    </View>
  );
}

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, isPublic: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={s.sheetTitle}>Start a room</Text>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        placeholder="Name, e.g. Hostel B"
        placeholderTextColor={C.textDim}
        autoFocus
        maxLength={60}
      />
      <View style={s.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Show to people nearby</Text>
          <Text style={s.switchSub}>{isPublic ? 'Anyone on this Wi-Fi can join' : 'Only people with your invite link'}</Text>
        </View>
        <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: C.coral, false: C.surfaceHigh }} />
      </View>
      <Button
        label="Start room"
        onPress={() => {
          onCreate(name, isPublic);
          setName('');
        }}
      />
      <Button label="Cancel" kind="secondary" onPress={onClose} />
    </Sheet>
  );
}

function JoinSheet({
  visible,
  onClose,
  onJoin,
}: {
  visible: boolean;
  onClose: () => void;
  onJoin: (key: string, name: string, owner?: string) => void;
}) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={s.sheetTitle}>Join with a link</Text>
      <View style={s.pasteRow}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={link}
          onChangeText={(t) => {
            setLink(t);
            setError(null);
          }}
          placeholder="awaaz://room/…"
          placeholderTextColor={C.textDim}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={async () => setLink(await Clipboard.getStringAsync())} style={s.pasteBtn}>
          <Text style={s.pasteText}>Paste</Text>
        </Pressable>
      </View>
      {error && <Text style={s.error}>{error}</Text>}
      <Button
        label="Join"
        onPress={() => {
          const invite = parseInvite(link);
          if (!invite) return setError("That doesn't look like an Awaaz invite link.");
          onJoin(invite.key, invite.name, invite.owner);
          setLink('');
        }}
      />
      <Button label="Cancel" kind="secondary" onPress={onClose} />
    </Sheet>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  wrap: { paddingHorizontal: 20, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: C.coral, fontSize: 40, fontWeight: '800' },
  gear: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  gearText: { color: C.text, fontSize: 22 },
  tagline: { color: C.text, fontSize: 20, fontWeight: '600', marginTop: -4 },
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 6,
  },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  stepIcon: { fontSize: 24 },
  stepText: { color: C.textDim, fontSize: 12, textAlign: 'center' },
  arrow: { color: C.textDim, fontSize: 16 },
  section: { color: C.textDim, fontSize: 13, fontWeight: '700', marginTop: 12, textTransform: 'uppercase', letterSpacing: 1 },
  emptyCard: { alignItems: 'center', backgroundColor: C.surface, borderRadius: 18, paddingVertical: 28, gap: 6 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  emptyText: { color: C.textDim, fontSize: 15 },
  room: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  roomNew: { borderColor: C.coral, backgroundColor: '#1F1A17' },
  pressed: { opacity: 0.75 },
  roomName: { color: C.text, fontSize: 19, fontWeight: '700' },
  roomSub: { color: C.textDim, fontSize: 14, marginTop: 2 },
  chevron: { color: C.textDim, fontSize: 30, lineHeight: 30 },
  joinPill: {
    color: C.onCoral,
    backgroundColor: C.coral,
    fontWeight: '800',
    fontSize: 16,
    borderRadius: 12,
    overflow: 'hidden',
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopColor: C.border,
    borderTopWidth: 1,
    backgroundColor: C.bg,
    gap: 4,
  },
  linkWrap: { alignSelf: 'center', paddingVertical: 8 },
  link: { color: C.coral, fontSize: 15, fontWeight: '600' },
  footer: { color: C.textDim, fontSize: 13, textAlign: 'center', marginTop: 16 },
  hubCard: { alignItems: 'center', backgroundColor: C.surface, borderRadius: 18, padding: 22, gap: 8, marginTop: 10 },
  hubIcon: { fontSize: 36 },
  hubTitle: { color: C.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  hubText: { color: C.textDim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderColor: C.border,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  sheetTitle: { color: C.text, fontSize: 22, fontWeight: '800' },
  input: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    color: C.text,
    padding: 14,
    fontSize: 17,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTitle: { color: C.text, fontSize: 16, fontWeight: '600' },
  switchSub: { color: C.textDim, fontSize: 13, marginTop: 2 },
  pasteRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  pasteBtn: { backgroundColor: C.surfaceHigh, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16 },
  pasteText: { color: C.text, fontWeight: '700' },
  error: { color: C.error },
});
