/**
 * Number and date wording for the You page, History and Recap (canvas
 * `You.dc.html`): "24.1 t", "4h 05m", "120 kg × 7 · Mon", "+0.4 this week".
 */

import type { MuscleCreditRow } from "@persistence/training-metrics";
import type { TopLift, TrainingTotals } from "@/domain/services/youPage";
import {
  dayThatSorts,
  sentenceList,
  toLocalDate,
} from "@/domain/services/youPage";
import type { WeightUnit } from "@/shared/utils";
import { volumeInUnit, weightInUnit } from "@/shared/utils";
import type { LiftRowData } from "./youKit";

const en = (n: number, digits = 0) =>
  n.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** "24.1 t" in tonnes; pounds for an imperial athlete ("12,400 lb"). */
export function volumeShort(kg: number, unit: WeightUnit): string {
  if (unit === "lb") return `${en(volumeInUnit(kg, unit))} lb`;
  return `${en(kg / 1000, 1)} t`;
}

/** "4h 05m". */
export function hoursMinutes(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "58 min". */
export const minutesText = (seconds: number) =>
  `${Math.max(0, Math.round(seconds / 60))} min`;

/** "Mon". */
export const weekday = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short" });

/** "07:10". */
export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** "22 Oct". */
export const dayMonth = (iso: string | Date) =>
  (typeof iso === "string" ? toLocalDate(iso) : iso).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "short" },
  );

/** "Today" for today's date, else "22 Oct". Date-only strings are local days. */
export function whenLabel(iso: string, now: Date): string {
  const d = toLocalDate(iso);
  return d.toDateString() === now.toDateString() ? "Today" : dayMonth(d);
}

/** "+0.4 this week", "−0.3 this month"; a true minus sign. */
export function deltaText(delta: number, period: string, digits = 1): string {
  const r = Number(delta.toFixed(digits));
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${en(Math.abs(r), digits)} ${period}`;
}

/** Y1b strip and Recap: "4", "24.1 t", "4h 05m". */
export function totalsStrip(t: TrainingTotals, unit: WeightUnit) {
  return {
    workouts: String(t.workouts),
    volume: volumeShort(t.volumeKg, unit),
    time: hoursMinutes(t.durationSeconds),
  };
}

/** A top lift as a `.lr` row: "120 kg × 7 · Mon" and its estimated 1RM. */
export function liftRows(
  lifts: readonly TopLift[],
  unit: WeightUnit,
): LiftRowData[] {
  return lifts.map((l, i) => ({
    key: l.exerciseId,
    rank: String(i + 1),
    name: l.name,
    detail: `${en(weightInUnit(l.weightKg, unit), 1).replace(/\.0$/, "")} ${unit} × ${l.reps} · ${weekday(l.startedAt)}`,
    value: `${en(Math.round(weightInUnit(l.oneRepMaxKg, unit) * 2) / 2, 1)} ${unit}`,
    gold: l.isRecord,
  }));
}

/** Train next / Rest lines for Y1, three muscles each. */
export function trainNextLine(
  rows: readonly MuscleCreditRow[],
): { text: string; hint: string } | null {
  const top = rows.slice(0, 3);
  if (!top.length) return null;
  const day = dayThatSorts(top.map((r) => r.group));
  return {
    text: sentenceList(top.map((r) => r.label.toLowerCase())),
    hint: day
      ? `Short of their week · ${day === "lower" ? "a lower" : "an upper"} day sorts it`
      : "Short of their week",
  };
}

export function restLine(
  rows: readonly MuscleCreditRow[],
): { text: string; hint: string } | null {
  const top = rows.slice(0, 3);
  if (!top.length) return null;
  return {
    text: sentenceList(top.map((r) => r.label.toLowerCase())),
    hint: "Hit their week · nice work",
  };
}
