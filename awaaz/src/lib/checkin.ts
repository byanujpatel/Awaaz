/**
 * Today's check-in state, computed on the child's phone (F5).
 * Pure and dependency-free so it can be tested on its own.
 */
type Entry = { role: string; type: string; at: number; name: string };

export type CheckinState =
  | { kind: 'ok'; at: number; by: string }
  | { kind: 'waiting'; deadline: Date }
  | { kind: 'missed'; deadline: Date };

export function checkinState(messages: Entry[], checkinBy: string, now = new Date()): CheckinState {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const [h, m] = checkinBy.split(':').map(Number);
  const deadline = new Date(midnight);
  deadline.setHours(h, m, 0, 0);

  const today = messages.find(
    (x) => x.role === 'parent' && (x.type === 'checkin' || x.type === 'log') && x.at >= midnight.getTime()
  );

  if (today) return { kind: 'ok', at: today.at, by: today.name };
  if (now > deadline) return { kind: 'missed', deadline };
  return { kind: 'waiting', deadline };
}
