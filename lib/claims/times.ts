// Local wall-clock times at airports ("YYYY-MM-DDTHH:mm", as <input type="datetime-local">).
// EU261 counts the arrival delay at the final destination, so we work in each airport's zone.

export type LocalTime = string;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** Offset of `tz` from UTC at `date`, in minutes (e.g. +120 for Madrid in summer). */
function offsetMinutes(tz: string, date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** A local time at an airport → instant. Unknown zone: the local time is treated as UTC. */
export function localToInstant(local: LocalTime, tz: string | null): Date {
  const m = local.match(LOCAL_RE);
  if (!m) throw new Error(`Invalid local time: ${local}`);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (!tz) return new Date(naive);
  // Two passes settle the offset around DST changes.
  let t = naive - offsetMinutes(tz, new Date(naive)) * 60000;
  t = naive - offsetMinutes(tz, new Date(t)) * 60000;
  return new Date(t);
}

/** Instant → local time at an airport (for prefilling datetime-local inputs). */
export function instantToLocal(instant: Date | string, tz: string | null): LocalTime {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const shifted = new Date(d.getTime() + (tz ? offsetMinutes(tz, d) : 0) * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** Minutes between two local times at the same airport (arrival delay). */
export function minutesLate(scheduled: LocalTime, actual: LocalTime, tz: string | null): number {
  return Math.round((localToInstant(actual, tz).getTime() - localToInstant(scheduled, tz).getTime()) / 60000);
}

/**
 * When the passenger only knows when the flight left: actual departure + the scheduled flight
 * duration. Departure and arrival times are in their own airports' zones.
 */
export function estimateArrival(input: {
  scheduledDep: LocalTime;
  scheduledArr: LocalTime;
  actualDep: LocalTime;
  depTz: string | null;
  arrTz: string | null;
}): LocalTime {
  const duration =
    localToInstant(input.scheduledArr, input.arrTz).getTime() - localToInstant(input.scheduledDep, input.depTz).getTime();
  const arrival = new Date(localToInstant(input.actualDep, input.depTz).getTime() + duration);
  return instantToLocal(arrival, input.arrTz);
}

export const formatMinutes = (m: number) => ({ hours: Math.floor(Math.abs(m) / 60), minutes: Math.abs(m) % 60 });
