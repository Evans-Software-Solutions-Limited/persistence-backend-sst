/**
 * Shared wording and number formats for the finish pages and Workout
 * details (PER-60 canvas row 3c).
 */

import type { RecordType } from "@/domain/models/record";
import type { SummaryRecord } from "@/domain/services/workoutSummary";
import type { WeightUnit } from "@/shared/utils";
import { volumeInUnit, weightInUnit } from "@/shared/utils";

/** Canvas wording: "Max weight", "1 rep max", "Max reps". */
export const RECORD_LABEL: Record<RecordType, string> = {
  "1rm": "1 rep max",
  "3rm": "3 rep max",
  "5rm": "5 rep max",
  "10rm": "10 rep max",
  max_weight: "Max weight",
  max_volume: "Max volume",
  max_reps: "Max reps",
  best_time: "Best time",
  longest_distance: "Longest distance",
};

const number = (n: number) =>
  n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** "4,820" in the athlete's unit. */
export const volumeText = (kg: number, unit: WeightUnit) =>
  volumeInUnit(kg, unit).toLocaleString("en-GB");

/** "62.5" in the athlete's unit. */
export const weightText = (kg: number, unit: WeightUnit) =>
  number(weightInUnit(kg, unit));

/** "1:05" or "1:02:08". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "52 min". */
export const minutes = (seconds: number) =>
  `${Math.max(0, Math.round(seconds / 60))} min`;

/** "23 Oct". */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** A record's value as number and unit: `{ value: "65", unit: "kg" }`. */
export function recordValue(
  type: RecordType,
  value: number,
  unit: WeightUnit,
): { value: string; unit: string } {
  switch (type) {
    case "max_reps":
      return { value: String(Math.round(value)), unit: "reps" };
    case "best_time":
      return { value: clock(value), unit: "" };
    case "longest_distance":
      return { value: number(value), unit: "m" };
    case "max_volume":
      return { value: volumeText(value, unit), unit };
    default:
      return { value: weightText(value, unit), unit };
  }
}

export const recordText = (
  record: Pick<SummaryRecord, "recordType">,
  value: number,
  unit: WeightUnit,
) => {
  const v = recordValue(record.recordType, value, unit);
  return v.unit ? `${v.value} ${v.unit}` : v.value;
};

/** "Brad", "Brad and Tom", "Brad, Tom and Inés". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
