import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from 'expo-audio';

import { MAX_VOICE_SEC } from '@/lib/config';
import { VOICE_PRESET } from '@/lib/audio';
import type { NetStatus } from '@/lib/transport';

// Logos palette (charcoal + coral), shared by every Awaaz screen.
export const C = {
  bg: '#141414',
  surface: '#1E1F22',
  surfaceHigh: '#2A2B2F',
  border: '#303236',
  coral: '#ED7B58',
  onCoral: '#241008',
  text: '#F5F5F5',
  textDim: '#9BA0A8',
  success: '#35C77F',
  warning: '#F5A623',
  error: '#E5533D',
} as const;

const NET_LABEL: Record<NetStatus, string> = {
  connecting: 'connecting to hub…',
  online: 'online',
  offline: 'offline — messages will queue',
};
const NET_COLOR: Record<NetStatus, string> = {
  connecting: C.warning,
  online: C.success,
  offline: C.error,
};

export function NetBadge({ net, pending }: { net: NetStatus; pending: number }) {
  return (
    <View style={s.badge}>
      <View style={[s.dot, { backgroundColor: NET_COLOR[net] }]} />
      <Text style={s.badgeText}>
        {NET_LABEL[net]}
        {pending > 0 ? ` · ${pending} queued` : ''}
      </Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        kind === 'primary' && s.btnPrimary,
        kind === 'secondary' && s.btnSecondary,
        kind === 'danger' && s.btnDanger,
        (pressed || disabled) && { opacity: 0.6 },
      ]}>
      <Text style={[s.btnText, kind === 'primary' && { color: C.onCoral }]}>{label}</Text>
    </Pressable>
  );
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

const fmtSecs = (n: number) => `0:${String(n).padStart(2, '0')}`;

/**
 * Tap once to start talking, tap Send to finish (or Cancel). No holding —
 * easier for older hands. Stops and sends by itself at MAX_VOICE_SEC.
 */
export function TapToSpeak({
  onRecorded,
  disabled,
  size = 200,
  hint = 'Tell your family how you are',
  idleLabel = 'Tap and speak',
  doneLabel = 'Send',
}: {
  onRecorded: (uri: string, durationSec: number) => Promise<void>;
  disabled?: boolean;
  size?: number;
  hint?: string;
  idleLabel?: string;
  doneLabel?: string;
}) {
  const recorder = useAudioRecorder(VOICE_PRESET);
  const [mode, setMode] = useState<'idle' | 'starting' | 'recording' | 'sending'>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Refs, not state: the timer and button handlers must see the live phase
  // even if they fire before a re-render.
  const phase = useRef<'idle' | 'starting' | 'recording' | 'sending'>('idle');
  const startedAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const go = (p: typeof phase.current) => {
    phase.current = p;
    setMode(p);
  };

  useEffect(() => () => {
    if (tick.current) clearInterval(tick.current);
  }, []);

  useEffect(() => {
    if (mode !== 'recording') return;
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [mode, pulse]);

  const finish = async (send: boolean) => {
    if (phase.current !== 'recording') return;
    if (tick.current) clearInterval(tick.current);
    go(send ? 'sending' : 'idle');
    await recorder.stop();
    const dur = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    if (!send) return;
    try {
      if (!recorder.uri) throw new Error('no recording');
      await onRecordedRef.current(recorder.uri, dur);
    } catch (e) {
      setError(`Could not send: ${e instanceof Error ? e.message : e}`);
    } finally {
      go('idle');
    }
  };

  const start = async () => {
    if (phase.current !== 'idle') return;
    setError(null);
    go('starting');
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) throw new Error('Microphone permission is off');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      go('idle');
      return;
    }
    startedAt.current = Date.now();
    setSecs(0);
    go('recording');
    tick.current = setInterval(() => {
      const n = Math.floor((Date.now() - startedAt.current) / 1000);
      setSecs(n);
      if (n >= MAX_VOICE_SEC) finish(true);
    }, 250);
  };

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  const recording = mode === 'recording';
  const round = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={s.speakWrap}>
      <View style={[s.micArea, { width: size * 1.4, height: size * 1.4 }]}>
        {recording && (
          <Animated.View
            style={[s.ring, round, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Finish recording' : idleLabel}
          disabled={disabled || mode === 'starting' || mode === 'sending'}
          onPress={recording ? () => finish(true) : start}
          style={({ pressed }) => [
            s.mic,
            round,
            recording && s.micRecording,
            (pressed || disabled) && { opacity: 0.85 },
          ]}>
          {mode === 'sending' || mode === 'starting' ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <>
              <Text style={[s.micIcon, { fontSize: size * 0.32 }]}>{recording ? '■' : '🎙️'}</Text>
              <Text style={[s.micLabel, { fontSize: Math.max(15, size * 0.11) }]}>
                {recording ? doneLabel : idleLabel}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <Text style={s.speakHint}>
        {mode === 'recording'
          ? `Listening… ${fmtSecs(secs)} / ${fmtSecs(MAX_VOICE_SEC)}`
          : mode === 'sending'
            ? 'Sending to your family…'
            : hint}
      </Text>
      {recording && (
        <Pressable onPress={() => finish(false)} style={s.cancel}>
          <Text style={s.cancelText}>✕ Cancel</Text>
        </Pressable>
      )}
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

let current: AudioPlayer | null = null;

export function PlayButton({ uri, durationSec }: { uri: string; durationSec: number }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    current?.remove();
    const p = createAudioPlayer(uri);
    current = p;
    setPlaying(true);
    p.addListener('playbackStatusUpdate', (st) => {
      if (st.didJustFinish) setPlaying(false);
    });
    p.play();
  };
  return (
    <Pressable onPress={play} style={s.play}>
      <Text style={s.playText}>{playing ? '🔊 Playing' : `▶︎ Play ${durationSec}s`}</Text>
    </Pressable>
  );
}

const MIC = 200;

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { color: C.textDim, fontSize: 13 },
  btn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  btnPrimary: { backgroundColor: C.coral },
  btnSecondary: { backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border },
  btnDanger: { backgroundColor: '#3A1B17', borderWidth: 1, borderColor: C.error },
  btnText: { color: C.text, fontSize: 16, fontWeight: '600' },
  speakWrap: { alignItems: 'center', gap: 10 },
  micArea: { width: MIC * 1.4, height: MIC * 1.4, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: MIC,
    height: MIC,
    borderRadius: MIC / 2,
    backgroundColor: C.error,
  },
  mic: {
    width: MIC,
    height: MIC,
    borderRadius: MIC / 2,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: C.coral,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  micRecording: { backgroundColor: C.error, shadowColor: C.error },
  micIcon: { fontSize: 64, color: '#fff' },
  micLabel: { color: '#fff', fontSize: 22, fontWeight: '800' },
  speakHint: { color: C.text, fontSize: 18, fontWeight: '600' },
  cancel: { paddingVertical: 8, paddingHorizontal: 16 },
  cancelText: { color: C.textDim, fontSize: 16 },
  error: { color: C.error, fontSize: 14, textAlign: 'center' },
  play: {
    alignSelf: 'flex-start',
    backgroundColor: C.surfaceHigh,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  playText: { color: C.text, fontSize: 14 },
});
