import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { C, NetBadge, TapToSpeak, fmtTime } from '@/components/awaaz/ui';
import { analyzeVoice, fileToBase64, speechState, type ModelState } from '@/lib/audio';
import { QUICK_TAGS, type TagKey } from '@/lib/config';
import { checkinState, type useFamily } from '@/lib/family';
import type { Profile } from '@/lib/storage';

type Family = ReturnType<typeof useFamily>;

const TAG = Object.fromEntries(QUICK_TAGS.map((t) => [t.key, t]));

const SPEECH_LABEL: Record<ModelState, string> = {
  ready: '🎙 Speech ready',
  loading: '🎙 Speech loading…',
  offline: '🎙 Speech offline — voice still sends',
};

type LastSent = { kind: 'voice' | 'ok'; transcript?: string; tags: TagKey[]; at: number };

/** F2/F3: speaking is the main action; "I'm OK" is the quiet alternative. */
export function ParentHome({
  profile,
  family,
  hubHost,
  onSettings,
}: {
  profile: Profile;
  family: Family;
  hubHost: string;
  onSettings: () => void;
}) {
  const [tags, setTags] = useState<TagKey[]>([]);
  const [last, setLast] = useState<LastSent | null>(null);
  const [speech, setSpeech] = useState<ModelState>('loading');
  const state = checkinState(family.messages, family.checkinBy);
  const mine = family.messages.filter((m) => m.role === 'parent' && m.type !== 'settings').slice(0, 4);

  useEffect(() => {
    const poll = () => speechState(hubHost).then(setSpeech);
    poll();
    const t = setInterval(poll, 10_000);
    return () => clearInterval(t);
  }, [hubHost]);

  const toggle = (k: TagKey) =>
    setTags((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));

  const sendVoice = async (uri: string, durationSec: number) => {
    const audio = await fileToBase64(uri);
    // Transcript + auto-tags from the hub; if it's unreachable the voice
    // message still goes out and the child's phone transcribes it later.
    const analysis = await analyzeVoice(hubHost, audio).catch(() => null);
    const autoTags = (analysis?.tags ?? []).filter((t) => !tags.includes(t));
    const allTags = [...tags, ...autoTags];
    await family.send({
      type: 'log',
      tags: allTags,
      audio,
      durationSec,
      ...(analysis ? { transcript: analysis.text, autoTags } : {}),
    });
    setTags([]);
    setLast({ kind: 'voice', transcript: analysis?.text, tags: allTags, at: Date.now() });
  };

  const sendOk = async () => {
    await family.send({ type: 'checkin', ok: true, tags });
    setLast({ kind: 'ok', tags, at: Date.now() });
    setTags([]);
  };

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <View style={s.header}>
        <Text style={s.hello}>Namaste, {profile.name}</Text>
        <Pressable onPress={onSettings} hitSlop={12}>
          <Text style={s.gear}>⚙︎</Text>
        </Pressable>
      </View>
      <View style={s.statusRow}>
        <NetBadge net={family.net} pending={family.pending} />
        <Text style={[s.chip, speech === 'ready' && s.chipReady]}>{SPEECH_LABEL[speech]}</Text>
      </View>

      <Text style={s.due}>
        {state.kind === 'ok'
          ? `✓ Checked in today at ${fmtTime(state.at)}`
          : `Please check in by ${family.checkinBy}`}
      </Text>

      <TapToSpeak onRecorded={sendVoice} />

      <View style={s.orRow}>
        <View style={s.line} />
        <Text style={s.or}>or just</Text>
        <View style={s.line} />
      </View>

      <Pressable
        onPress={sendOk}
        accessibilityRole="button"
        style={({ pressed }) => [s.ok, pressed && { transform: [{ scale: 0.98 }] }]}>
        <Text style={s.okText}>✓  I'm OK</Text>
      </Pressable>

      <Text style={s.tagsTitle}>Add if you like</Text>
      <View style={s.tags}>
        {QUICK_TAGS.map((t) => {
          const on = tags.includes(t.key);
          return (
            <Pressable
              key={t.key}
              onPress={() => toggle(t.key)}
              style={[s.tag, on && (t.key === 'unwell' ? s.tagUnwell : s.tagOn)]}>
              <Text style={s.tagText}>
                {t.emoji} {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {last && (
        <View style={s.sent}>
          <Text style={s.sentHead}>
            ✓ Sent at {fmtTime(last.at)} {last.kind === 'voice' ? '· voice message' : "· I'm OK"}
          </Text>
          {last.kind === 'voice' && (
            <Text style={s.sentText}>
              {last.transcript ? `“${last.transcript}”` : 'Your family will hear your voice.'}
            </Text>
          )}
          {last.tags.length > 0 && (
            <Text style={s.sentTags}>
              {last.tags.map((t) => `${TAG[t]?.emoji} ${TAG[t]?.label}`).join('   ')}
            </Text>
          )}
        </View>
      )}

      <Text style={s.privacy}>Only your family's paired phones can see or hear these.</Text>

      {mine.length > 0 && (
        <View>
          <Text style={s.recentTitle}>Recently sent</Text>
          {mine.map((m) => (
            <Text key={m.id} style={s.recent}>
              {fmtTime(m.at)} · {m.type === 'log' ? `🎙️ voice ${m.durationSec}s` : "✓ I'm OK"}
              {'tags' in m && m.tags.length ? ` · ${m.tags.map((t) => TAG[t]?.emoji).join(' ')}` : ''}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 14, paddingTop: 64, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hello: { color: C.text, fontSize: 26, fontWeight: '700' },
  gear: { color: C.textDim, fontSize: 26 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  chip: {
    color: C.textDim,
    fontSize: 12,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  chipReady: { color: C.success },
  due: { color: C.text, fontSize: 18, textAlign: 'center', marginTop: 4 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: C.border },
  or: { color: C.textDim, fontSize: 14 },
  ok: {
    backgroundColor: C.success,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
  },
  okText: { color: '#06281A', fontSize: 24, fontWeight: '800' },
  tagsTitle: { color: C.textDim, fontSize: 14, textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  tag: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  tagOn: { backgroundColor: '#183A2A', borderColor: C.success },
  tagUnwell: { backgroundColor: '#3A1B17', borderColor: C.error },
  tagText: { color: C.text, fontSize: 16 },
  sent: { backgroundColor: '#183A2A', borderColor: C.success, borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  sentHead: { color: C.success, fontSize: 16, fontWeight: '700' },
  sentText: { color: C.text, fontSize: 17, fontStyle: 'italic' },
  sentTags: { color: C.text, fontSize: 15 },
  privacy: { color: C.textDim, fontSize: 13, textAlign: 'center' },
  recentTitle: { color: C.textDim, fontSize: 14, marginBottom: 4 },
  recent: { color: C.text, fontSize: 14, paddingVertical: 2 },
});
