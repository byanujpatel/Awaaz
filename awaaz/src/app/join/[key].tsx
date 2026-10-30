import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { C } from '@/components/awaaz/ui';
import { joinRoom, parseInvite, roomId } from '@/lib/rooms';

/** awaaz://room/<key>?n=<name>&m=<moderator key> lands here (via +not-found): join, then open the room. */
export default function JoinRoom() {
  const { key, n, m } = useLocalSearchParams<{ key: string; n?: string; m?: string }>();

  useEffect(() => {
    const invite = parseInvite(`${key ?? ''}?n=${encodeURIComponent(n ?? '')}${m ? `&m=${m}` : ''}`);
    if (!invite) {
      router.replace('/');
      return;
    }
    joinRoom(invite.key, invite.name, false, invite.owner).then((room) => router.replace(`/room/${roomId(room.key)}` as any));
  }, [key, n, m]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center' }}>
      <ActivityIndicator color={C.coral} />
    </View>
  );
}
