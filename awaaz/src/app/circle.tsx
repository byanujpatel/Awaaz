import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ChildHome } from '@/components/awaaz/child-home';
import { Onboarding } from '@/components/awaaz/onboarding';
import { ParentHome } from '@/components/awaaz/parent-home';
import { Settings } from '@/components/awaaz/settings';
import { C } from '@/components/awaaz/ui';
import type { Identity } from '@/lib/crypto';
import { familyIdFromKey } from '@/lib/crypto';
import { DEFAULT_HUB_HOST } from '@/lib/config';
import { useFamily } from '@/lib/family';
import {
  clearFamilyData,
  loadHubHost,
  loadIdentity,
  loadProfile,
  saveHubHost,
  saveProfile,
  type Profile,
} from '@/lib/storage';

export default function FamilyCircle() {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hubHost, setHubHost] = useState(DEFAULT_HUB_HOST);

  // Reload on focus: the family/[key] deep-link route may have just joined.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        setIdentity(await loadIdentity());
        setProfile(await loadProfile());
        setHubHost(await loadHubHost());
        setReady(true);
      })();
    }, [])
  );

  if (!ready || !identity) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={C.coral} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Onboarding
          onDone={async (p) => {
            await saveProfile(p);
            setProfile(p);
          }}
        />
      </View>
    );
  }

  return (
    <FamilyApp
      key={profile.familyKey}
      profile={profile}
      identity={identity}
      hubHost={hubHost}
      onHubHost={async (h) => {
        await saveHubHost(h);
        setHubHost(h);
      }}
      onReset={async () => {
        await clearFamilyData(familyIdFromKey(profile.familyKey));
        setProfile(null);
      }}
    />
  );
}

function FamilyApp({
  profile,
  identity,
  hubHost,
  onHubHost,
  onReset,
}: {
  profile: Profile;
  identity: Identity;
  hubHost: string;
  onHubHost: (h: string) => void;
  onReset: () => void;
}) {
  const family = useFamily(profile, identity, hubHost);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {showSettings ? (
        <Settings
          profile={profile}
          hubHost={hubHost}
          onHubHost={onHubHost}
          onClose={() => setShowSettings(false)}
          onReset={onReset}
        />
      ) : profile.role === 'parent' ? (
        <ParentHome
          profile={profile}
          family={family}
          hubHost={hubHost}
          onSettings={() => setShowSettings(true)}
        />
      ) : (
        <ChildHome
          profile={profile}
          family={family}
          hubHost={hubHost}
          onSettings={() => setShowSettings(true)}
        />
      )}
    </View>
  );
}
