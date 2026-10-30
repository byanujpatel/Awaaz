import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { RoomScreen } from '@/components/awaaz/room';
import { C } from '@/components/awaaz/ui';
import { leaveRoom, loadRooms, resetIdentity, roomId, type Room } from '@/lib/rooms';
import { loadHubHost } from '@/lib/storage';

export default function RoomRoute() {
  const { id, n } = useLocalSearchParams<{ id: string; n?: string }>();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [hubHost, setHubHost] = useState<string | null>(null);

  useEffect(() => {
    // An invite link (awaaz://room/<key>?n=…) lands here with the 64-hex key
    // in place of the room id: hand it to the join flow.
    if (/^[0-9a-f]{64}$/i.test(id ?? '')) {
      router.replace(`/join/${id}${n ? `?n=${encodeURIComponent(n)}` : ''}` as any);
      return;
    }
    loadRooms().then((rs) => setRoom(rs.find((r) => roomId(r.key) === id) ?? null));
    loadHubHost().then(setHubHost);
  }, [id, n]);

  if (room === undefined || hubHost === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={C.coral} />
      </View>
    );
  }
  if (room === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: C.text, fontSize: 18 }}>This room isn't on this phone. Join it with an invite link.</Text>
      </View>
    );
  }

  const onResetIdentity = () =>
    Alert.alert(
      'Get a new anonymous name?',
      'You will appear under a new random name. Your earlier posts stay, but nobody (not even this phone) can link them to you any more.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'New name', onPress: async () => setRoom(await resetIdentity(room.key)) },
      ]
    );

  const onLeave = () =>
    Alert.alert('Leave this room?', 'It is removed from this phone, with its history. You can join again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leaveRoom(room.key);
          router.back();
        },
      },
    ]);

  // Keyed by identity so a reset starts a clean session under the new name.
  return (
    <RoomScreen
      key={room.me.pub}
      room={room}
      hubHost={hubHost}
      onResetIdentity={onResetIdentity}
      onLeave={onLeave}
    />
  );
}
