/**
 * Shared wording and number formats for the finish pages and Workout
 * details (PER-60 canvas row 3c).
 */

import type { RecordType } from "@/domain/models/record";
import type {
  MuscleShare,
  SummaryPage,
  SummaryRecord,
  WorkoutSummaryModel,
} from "@/domain/services/workoutSummary";
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

/**
 * What Share sends for one summary page, as text: the system share sheet
 * carries it today; sharing the page as an image needs a native build.
 */
export function summaryShareText(
  page: SummaryPage | "details",
  p: {
    model: WorkoutSummaryModel;
    muscles: MuscleShare;
    records: readonly SummaryRecord[];
    rating: number | null;
    together?: { names: readonly string[]; connection: string } | null;
    unit: WeightUnit;
  },
): string {
  const m = p.model;
  const head = `${m.name} · ${shortDate(m.startedAt)} · ${minutes(m.durationSeconds)}`;
  const kg = (v: number) => `${volumeText(v, p.unit)} ${p.unit}`;
  const lines: string[] = [];
  switch (page) {
    case "totals":
      lines.push(
        `Workout complete: ${head}`,
        `${kg(m.volumeKg)} · ${m.sets} sets · ${m.reps} reps`,
      );
      if (p.rating != null) lines.push(`Effort ${p.rating}/10`);
      break;
    case "muscles":
      lines.push(head, p.muscles.accessibilityLabel);
      break;
    case "exercises":
      lines.push(head, ...m.exercises.map((e) => `${e.name} ${e.setsLabel}`));
      break;
    case "volume":
      lines.push(
        `Volume by exercise: ${head}`,
        ...m.volume.map((v) => `${v.name} ${kg(v.volumeKg)}`),
      );
      break;
    case "records":
      lines.push(
        p.records.length === 1
          ? "New personal record"
          : `${p.records.length} new personal records`,
        ...p.records.map(
          (r) =>
            `${r.exerciseName}: ${RECORD_LABEL[r.recordType]} ${recordText(r, r.newValue, p.unit)}`,
        ),
      );
      break;
    case "together":
      lines.push(
        `Trained together with ${listNames(p.together?.names ?? [])}`,
        `${head} · ${p.together?.connection ?? ""}`.replace(/ · $/, ""),
      );
      break;
    case "details":
      lines.push(
        head,
        `${kg(m.volumeKg)} · ${m.sets} sets · ${m.reps} reps`,
        ...m.exercises.map(
          (e) =>
            `${e.name}: ${e.sets
              .map((s) =>
                s.weightKg != null && s.reps != null
                  ? `${weightText(s.weightKg, p.unit)}×${s.reps}`
                  : s.reps != null
                    ? `${s.reps}`
                    : `set ${s.n}`,
              )
              .join(", ")}`,
        ),
      );
      break;
  }
  return [...lines, "Logged with Persistence"].join("\n");
}
