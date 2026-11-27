import { isCoachApiError } from "../api/coachApi";
import type {
  ClientPhoto,
  ClientPhotoSet,
  PhotoPose,
  PhotosDenial,
} from "./types";

/** Pure helpers for the C3.4 Photos tab (PER-138). */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The server's 403 codes, as the state the tab shows. */
const DENIALS: Record<string, PhotosDenial> = {
  photos_off: "photos_off",
  photo_sharing_not_granted: "not_shared",
  not_your_client: "ended",
  account_deleted: "ended",
};

/**
 * Why the server refused the photos, or null for any other failure. The
 * server has the final say: a refusal always wins over photos already shown.
 */
export function denialOf(e: unknown): PhotosDenial | null {
  if (!isCoachApiError(e) || e.status !== 403 || !e.code) return null;
  return DENIALS[e.code] ?? null;
}

/** "26 Oct" from a `YYYY-MM-DD` date (no time zone shift). */
export function dateLabel(takenOn: string): string {
  const [, m, d] = takenOn.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

function dayNumber(takenOn: string): number {
  const [y, m, d] = takenOn.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
export function daysBetween(a: string, b: string): number {
  return Math.round(dayNumber(b) - dayNumber(a));
}

/** Ready sets, newest first (by date, then by when they were added). */
export function newestFirst(sets: readonly ClientPhotoSet[]): ClientPhotoSet[] {
  return sets
    .filter((s) => s.status === "ready")
    .sort((a, b) =>
      a.takenOn === b.takenOn
        ? b.createdAt.localeCompare(a.createdAt)
        : b.takenOn.localeCompare(a.takenOn),
    );
}

/** "6 sets · every 1–2 weeks" (canvas C3.4a). `sets` newest first. */
export function cadenceLabel(sets: readonly ClientPhotoSet[]): string {
  const count = `${sets.length} ${sets.length === 1 ? "set" : "sets"}`;
  if (sets.length < 2) return count;
  const weeks = sets
    .slice(1)
    .map((s, i) =>
      Math.max(1, Math.round(daysBetween(s.takenOn, sets[i]!.takenOn) / 7)),
    );
  const min = Math.min(...weeks);
  const max = Math.max(...weeks);
  const every =
    min === max
      ? min === 1
        ? "every week"
        : `every ${min} weeks`
      : `every ${min}–${max} weeks`;
  return `${count} · ${every}`;
}

export function photoFor(
  set: ClientPhotoSet | null | undefined,
  pose: PhotoPose,
): ClientPhoto | null {
  return set?.photos.find((p) => p.pose === pose) ?? null;
}

/** The two sets being compared: the first and the latest, by default. */
export function defaultPair(
  sets: readonly ClientPhotoSet[],
): [string, string] | null {
  if (sets.length < 2) return null;
  return [sets[sets.length - 1]!.id, sets[0]!.id];
}

/**
 * The pair as [older, newer], whatever order they were picked in. Ids no
 * longer in the list (a set the client deleted) fall back to the default.
 */
export function orderedPair(
  sets: readonly ClientPhotoSet[],
  pair: readonly [string, string] | null,
): [ClientPhotoSet, ClientPhotoSet] | null {
  const fallback = defaultPair(sets);
  if (!fallback) return null;
  const find = (id: string) => sets.find((s) => s.id === id);
  let a = pair ? find(pair[0]) : undefined;
  let b = pair ? find(pair[1]) : undefined;
  if (!a || !b || a.id === b.id) {
    a = find(fallback[0])!;
    b = find(fallback[1])!;
  }
  return sets.indexOf(a) > sets.indexOf(b) ? [a, b] : [b, a];
}

const one = (n: number) => n.toFixed(1);

export interface CompareStats {
  weight: { from: string; to: string };
  bodyFat: { from: string; to: string };
  apart: { value: string; unit: "wk" | "d" };
}

/** The strip under the compare: weight, body fat and time apart. */
export function compareStats(
  older: ClientPhotoSet,
  newer: ClientPhotoSet,
): CompareStats {
  const days = Math.abs(daysBetween(older.takenOn, newer.takenOn));
  const kg = (s: ClientPhotoSet) => (s.weight ? one(s.weight.kg) : "–");
  const fat = (s: ClientPhotoSet) =>
    s.bodyFat ? one(s.bodyFat.percentage) : "–";
  return {
    weight: { from: kg(older), to: kg(newer) },
    bodyFat: { from: fat(older), to: fat(newer) },
    apart:
      days < 7
        ? { value: String(days), unit: "d" }
        : { value: String(Math.round(days / 7)), unit: "wk" },
  };
}
