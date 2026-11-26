import type { Campaign } from "./workspace";

/**
 * Automatic morning searches for a campaign.
 *
 * The user turns it on for a first week. After that, every extension is three
 * more days and needs their OK again, so a search never keeps running (or using
 * their assistant's allowance) unnoticed. Searches run only while Career Desk is
 * open on this PC; a missed morning runs when it is next opened that day.
 */

export const FIRST_RUN_DAYS = 7;
export const EXTEND_DAYS = 3;
export const DEFAULT_TIME = "09:00";

/** Local calendar day, YYYY-MM-DD. */
export function localDay(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
}

const hhmm = (at: Date) =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

export function startSchedule(
  c: Campaign,
  at: Date,
  opts: { useAssistant?: boolean; time?: string } = {},
) {
  const today = localDay(at);
  c.schedule = {
    time: opts.time ?? DEFAULT_TIME,
    until: addDays(today, FIRST_RUN_DAYS - 1),
    useAssistant: opts.useAssistant ?? false,
    lastRunDay: "",
    lastResult: "",
    extensions: 0,
    consentAt: at.toISOString(),
  };
}

export function stopSchedule(c: Campaign) {
  c.schedule = undefined;
}

/** Three more days, counted from the end date (or from today if it has ended). */
export function extendSchedule(c: Campaign, at: Date, days = EXTEND_DAYS) {
  const s = c.schedule;
  if (!s) throw new Error("This campaign has no automatic search to extend");
  const today = localDay(at);
  const from = s.until >= today ? s.until : addDays(today, -1);
  s.until = addDays(from, days);
  s.extensions += 1;
  s.consentAt = at.toISOString();
}

export type ScheduleState =
  | { kind: "off" }
  | { kind: "active"; daysLeft: number; lastDay: boolean }
  | { kind: "ended"; endedOn: string };

export function scheduleState(c: Campaign, at: Date): ScheduleState {
  const s = c.schedule;
  if (!s) return { kind: "off" };
  const today = localDay(at);
  if (today > s.until) return { kind: "ended", endedOn: s.until };
  const daysLeft =
    Math.round((Date.parse(`${s.until}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000) +
    1;
  return { kind: "active", daysLeft, lastDay: daysLeft <= 1 };
}

/** Ask to extend on the last day and after it ends. */
export function needsExtension(c: Campaign, at: Date): boolean {
  const st = scheduleState(c, at);
  return st.kind === "ended" || (st.kind === "active" && st.lastDay);
}

/** Today's search is due: active, after the set time, and not yet run today. */
export function isDue(c: Campaign, at: Date): boolean {
  const s = c.schedule;
  if (!s || scheduleState(c, at).kind !== "active") return false;
  return s.lastRunDay !== localDay(at) && hhmm(at) >= s.time;
}
