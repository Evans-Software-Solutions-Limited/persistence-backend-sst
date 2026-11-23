import type { FormSchedule, RuleOverride } from "../api/types";

/**
 * Repeating check-in rules (C11 "Repeating check-ins"; backend
 * coaching/forms/scheduleRepository.ts). Weekdays are 1 (Mon) … 7 (Sun).
 * Due time and reminders are stored as hours after the form is sent; the
 * screen shows them as a weekday and a time, so this file converts both ways.
 */

export const WEEKDAY_SHORT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
export const WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const HOURS_IN_WEEK = 168;
export const MAX_REMINDERS = 5;

export interface EffectiveRule {
  trigger: string;
  weekday: number | null;
  timeLocal: string | null;
  dueAfterHours: number | null;
  reminders: { afterHours: number }[];
}

/** The schedule's own rule with this client's override on top. */
export function effectiveRule(
  schedule: FormSchedule,
  override: RuleOverride | null | undefined,
): EffectiveRule {
  const o = override ?? {};
  return {
    trigger: schedule.trigger,
    weekday: o.weekday ?? schedule.weekday,
    timeLocal: o.timeLocal ?? schedule.timeLocal,
    dueAfterHours: o.dueAfterHours ?? schedule.dueAfterHours,
    reminders: o.reminders ?? schedule.reminders ?? [],
  };
}

/** "09:00" → minutes after midnight; null when malformed. */
export function parseTime(hhmm: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The weekday and time a point `afterHours` after the send falls on. Weekly
 * rules carry a weekday; daily rules don't (weekday comes back null).
 */
export function pointAfter(
  rule: Pick<EffectiveRule, "weekday" | "timeLocal">,
  afterHours: number,
): { weekday: number | null; time: string } | null {
  const start = parseTime(rule.timeLocal);
  if (start === null) return null;
  const total = start + afterHours * 60;
  const dayOffset = Math.floor(total / 1440);
  const weekday =
    rule.weekday === null ? null : ((rule.weekday - 1 + dayOffset) % 7) + 1;
  return { weekday, time: formatTime(total) };
}

/**
 * Hours from the send to a chosen weekday + time (weekly) or time (daily).
 * Always 1 … one cycle: the same moment as the send means a full cycle later.
 */
export function hoursUntil(
  rule: Pick<EffectiveRule, "weekday" | "timeLocal">,
  target: { weekday: number | null; time: string },
): number | null {
  const start = parseTime(rule.timeLocal);
  const end = parseTime(target.time);
  if (start === null || end === null) return null;
  const weekly = rule.weekday !== null && target.weekday !== null;
  const cycle = weekly ? HOURS_IN_WEEK * 60 : 24 * 60;
  const from = weekly ? (rule.weekday! - 1) * 1440 + start : start;
  const to = weekly ? (target.weekday! - 1) * 1440 + end : end;
  let diff = (((to - from) % cycle) + cycle) % cycle;
  if (diff === 0) diff = cycle;
  return Math.max(1, Math.round(diff / 60));
}

function pointLabel(
  p: { weekday: number | null; time: string } | null,
  names: string[],
): string | null {
  if (!p) return null;
  return p.weekday === null ? p.time : `${names[p.weekday - 1]} ${p.time}`;
}

export function dueLabel(rule: EffectiveRule): string | null {
  if (rule.dueAfterHours === null) return null;
  return pointLabel(pointAfter(rule, rule.dueAfterHours), WEEKDAY_ABBR);
}

export function reminderLabel(
  rule: EffectiveRule,
  afterHours: number,
): string | null {
  return pointLabel(pointAfter(rule, afterHours), WEEKDAY_LONG);
}

function frequency(trigger: string): string {
  return trigger === "weekly"
    ? "Weekly"
    : trigger === "daily"
      ? "Daily"
      : trigger === "once"
        ? "Once"
        : trigger;
}

function reminderCount(n: number): string | null {
  return n === 0 ? null : n === 1 ? "1 reminder" : `${n} reminders`;
}

/** Checklist line: "Weekly · Sun 09:00 · 2 reminders". */
export function ruleSummary(rule: EffectiveRule): string {
  const when =
    rule.trigger === "weekly" && rule.weekday && rule.timeLocal
      ? `${WEEKDAY_ABBR[rule.weekday - 1]} ${rule.timeLocal}`
      : rule.trigger === "daily" && rule.timeLocal
        ? rule.timeLocal
        : null;
  return [frequency(rule.trigger), when, reminderCount(rule.reminders.length)]
    .filter(Boolean)
    .join(" · ");
}

/** Overview line: "Sundays 09:00 · due Mon 12:00 · 2 reminders". */
export function ruleDetail(rule: EffectiveRule): string {
  const when =
    rule.trigger === "weekly" && rule.weekday && rule.timeLocal
      ? `${WEEKDAY_LONG[rule.weekday - 1]}s ${rule.timeLocal}`
      : rule.trigger === "daily" && rule.timeLocal
        ? `Daily ${rule.timeLocal}`
        : frequency(rule.trigger);
  const due = dueLabel(rule);
  return [when, due ? `due ${due}` : null, reminderCount(rule.reminders.length)]
    .filter(Boolean)
    .join(" · ");
}

/** Only the fields that differ from the schedule go in the override. */
export function overrideFrom(
  schedule: FormSchedule,
  rule: EffectiveRule,
): RuleOverride | null {
  const o: RuleOverride = {};
  if (rule.weekday !== schedule.weekday) o.weekday = rule.weekday;
  if (rule.timeLocal !== schedule.timeLocal) o.timeLocal = rule.timeLocal;
  if (rule.dueAfterHours !== schedule.dueAfterHours) {
    o.dueAfterHours = rule.dueAfterHours;
  }
  const same =
    rule.reminders.length === schedule.reminders.length &&
    rule.reminders.every(
      (r, i) => r.afterHours === schedule.reminders[i]?.afterHours,
    );
  if (!same) o.reminders = rule.reminders;
  return Object.keys(o).length === 0 ? null : o;
}

/** Sorted, de-duplicated, at most five (the backend's own normalisation). */
export function normaliseReminders(
  reminders: { afterHours: number }[],
): { afterHours: number }[] {
  return [...new Set(reminders.map((r) => r.afterHours))]
    .filter((h) => Number.isInteger(h) && h >= 1 && h <= 720)
    .sort((a, b) => a - b)
    .slice(0, MAX_REMINDERS)
    .map((afterHours) => ({ afterHours }));
}

export function isRepeatingTrigger(trigger: string): boolean {
  return trigger === "once" || trigger === "weekly" || trigger === "daily";
}
