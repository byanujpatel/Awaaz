import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { C, NetBadge, PlayButton, fmtDay, fmtTime } from '@/components/awaaz/ui';
import { base64ToCachedFile, transcribe } from '@/lib/audio';
import { QUICK_TAGS } from '@/lib/config';
import { checkinState, type FamilyMsg, type useFamily } from '@/lib/family';
import { loadTranscripts, saveTranscripts, type Profile } from '@/lib/storage';

type Family = ReturnType<typeof useFamily>;

const TAG = Object.fromEntries(QUICK_TAGS.map((t) => [t.key, t]));

function shiftTime(hhmm: string, deltaMin: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (((h * 60 + m + deltaMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** F4–F6, F8: status card, check-in window, timeline with audio + transcripts. */
export function ChildHome({
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
  const [now, setNow] = useState(new Date());
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  // Failures stay out of the persisted map so they retry when the hub is back.
  const [failed, setFailed] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    loadTranscripts().then(setTranscripts);
    return () => clearInterval(t);
  }, []);

  // F8: transcribe new voice logs on the Mac hub, once each.
  useEffect(() => {
    const todo = family.messages.filter(
      (m) =>
        m.type === 'log' &&
        m.audio &&
        m.transcript === undefined && // parent's phone usually sends text along
        transcripts[m.id] === undefined &&
        !failed[m.id]
    );
    if (todo.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = { ...transcripts };
      const errs: Record<string, string> = {};
      for (const m of todo) {
        if (m.type !== 'log') continue;
        try {
          next[m.id] = await transcribe(hubHost, m.audio);
        } catch (e) {
          errs[m.id] = e instanceof Error ? e.message : String(e);
        }
      }
      if (cancelled) return;
      setTranscripts(next);
      saveTranscripts(next);
      if (Object.keys(errs).length) {
        setFailed((f) => ({ ...f, ...errs }));
        // Retry failed clips in a minute (hub may be offline).
        setTimeout(() => setFailed((f) => {
          const g = { ...f };
          Object.keys(errs).forEach((k) => delete g[k]);
          return g;
        }), 60_000);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [family.messages, transcripts, failed, hubHost]);

  const state = checkinState(family.messages, family.checkinBy, now);
  const timeline = family.messages.filter((m) => m.role === 'parent' && m.type !== 'settings');

  const setWindow = (delta: number) =>
    family.send({
      type: 'settings',
      checkinBy: shiftTime(family.checkinBy, delta),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

  return (
    <FlatList
      data={timeline}
      keyExtractor={(m) => m.id}
      contentContainerStyle={s.wrap}
      ListHeaderComponent={
        <View style={{ gap: 14 }}>
          <View style={s.header}>
            <Text style={s.hello}>Hi {profile.name}</Text>
            <Pressable onPress={onSettings}>
              <Text style={s.gear}>⚙︎</Text>
            </Pressable>
          </View>
          <NetBadge net={family.net} pending={family.pending} />

          <View
            style={[
              s.status,
              state.kind === 'ok' && s.statusOk,
              state.kind === 'missed' && s.statusMissed,
            ]}>
            {state.kind === 'ok' && (
              <>
                <Text style={s.statusBig}>✓ {state.by} checked in</Text>
                <Text style={s.statusSmall}>Today at {fmtTime(state.at)}</Text>
              </>
            )}
            {state.kind === 'waiting' && (
              <>
                <Text style={s.statusBig}>Waiting for today's check-in</Text>
                <Text style={s.statusSmall}>Due by {family.checkinBy}</Text>
              </>
            )}
            {state.kind === 'missed' && (
              <>
                <Text style={s.statusBig}>⚠︎ Missed check-in</Text>
                <Text style={s.statusSmall}>
                  Nothing received by {family.checkinBy}. Consider calling.
                </Text>
              </>
            )}
          </View>

          <View style={s.window}>
            <Text style={s.windowLabel}>Daily check-in by</Text>
            <Pressable style={s.step} onPress={() => setWindow(-30)}>
              <Text style={s.stepText}>−</Text>
            </Pressable>
            <Text style={s.windowTime}>{family.checkinBy}</Text>
            <Pressable style={s.step} onPress={() => setWindow(30)}>
              <Text style={s.stepText}>+</Text>
            </Pressable>
          </View>

          <Text style={s.section}>Timeline</Text>
          {timeline.length === 0 && <Text style={s.empty}>No check-ins yet.</Text>}
        </View>
      }
      renderItem={({ item, index }) => (
        <>
          {(index === 0 || fmtDay(timeline[index - 1].at) !== fmtDay(item.at)) && (
            <Text style={s.day}>{fmtDay(item.at)}</Text>
          )}
          <Entry
            m={item}
            transcript={item.type === 'log' ? (item.transcript ?? transcripts[item.id]) : undefined}
            error={failed[item.id]}
          />
        </>
      )}
    />
  );
}

function Entry({ m, transcript, error }: { m: FamilyMsg; transcript?: string; error?: string }) {
  if (m.type === 'settings') return null;
  const unwell = m.tags.includes('unwell');
  return (
    <View style={[s.card, unwell && s.cardUnwell]}>
      <Text style={s.cardHead}>
        {fmtTime(m.at)} · {m.name} · {m.type === 'checkin' ? "✓ I'm OK" : '🎙️ Voice message'}
      </Text>
      {m.tags.length > 0 && (
        <View style={s.tags}>
          {m.tags.map((t) => (
            <Text key={t} style={[s.tag, t === 'unwell' && s.tagUnwell]}>
              {TAG[t]?.emoji} {TAG[t]?.label ?? t}
              {m.type === 'log' && m.autoTags?.includes(t) ? ' ✨' : ''}
            </Text>
          ))}
        </View>
      )}
      {m.type === 'log' && (
        <>
          <PlayButton uri={base64ToCachedFile(m.id, m.audio)} durationSec={m.durationSec} />
          <Text style={s.transcript}>
            {transcript
              ? `“${transcript}”`
              : error
                ? `Transcript unavailable (${error}) — will retry`
                : transcript === undefined
                  ? 'Transcribing…'
                  : ''}
          </Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 70, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hello: { color: C.text, fontSize: 26, fontWeight: '700' },
  gear: { color: C.textDim, fontSize: 26 },
  status: { backgroundColor: C.surface, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: C.border },
  statusOk: { backgroundColor: '#183A2A', borderColor: C.success },
  statusMissed: { backgroundColor: '#3A1B17', borderColor: C.error },
  statusBig: { color: C.text, fontSize: 22, fontWeight: '700' },
  statusSmall: { color: C.textDim, fontSize: 15, marginTop: 4 },
  window: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  windowLabel: { color: C.textDim, fontSize: 15, flex: 1 },
  windowTime: { color: C.text, fontSize: 18, fontWeight: '600', minWidth: 56, textAlign: 'center' },
  step: { backgroundColor: C.surfaceHigh, borderRadius: 10, width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: C.text, fontSize: 20 },
  section: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  empty: { color: C.textDim },
  day: { color: C.textDim, fontSize: 13, marginTop: 8 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  cardUnwell: { borderColor: C.error, backgroundColor: '#2A1512' },
  cardHead: { color: C.text, fontSize: 15, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { color: C.text, backgroundColor: C.surfaceHigh, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8, overflow: 'hidden', fontSize: 13 },
  tagUnwell: { backgroundColor: C.error, color: '#fff', fontWeight: '700' },
  transcript: { color: C.text, fontSize: 16, lineHeight: 22, fontStyle: 'italic', marginTop: 8 },
});
