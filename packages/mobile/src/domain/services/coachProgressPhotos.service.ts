import type { CoachPhotosDenial } from "@/domain/models/coachProgressPhotos";
import type {
  ProgressPhoto,
  ProgressPhotoPose,
  ProgressPhotoSet,
} from "@/domain/models/progressPhotos";

/** PER-138: pure helpers for the coach's Photos tab and compare (C3.4). */

/** The server's 403 codes, as the state the tab shows. */
const DENIALS: Record<string, CoachPhotosDenial> = {
  photos_off: "photos_off",
  photo_sharing_not_granted: "not_shared",
  not_your_client: "ended",
  account_deleted: "ended",
};

/** A 403 body's `code` as a denial, or undefined for any other answer. */
export function denialFromResponse(
  status: number,
  code: unknown,
): CoachPhotosDenial | undefined {
  if (status !== 403 || typeof code !== "string") return undefined;
  return DENIALS[code];
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
export function coachSetsNewestFirst(
  sets: readonly ProgressPhotoSet[],
): ProgressPhotoSet[] {
  return sets
    .filter((s) => s.status === "ready")
    .sort((a, b) =>
      a.takenOn === b.takenOn
        ? b.createdAt.localeCompare(a.createdAt)
        : b.takenOn.localeCompare(a.takenOn),
    );
}

export function photoForPose(
  set: ProgressPhotoSet | null | undefined,
  pose: ProgressPhotoPose,
): ProgressPhoto | null {
  return set?.photos.find((p) => p.pose === pose) ?? null;
}

/** The first and the latest set (ids), or null with fewer than two. */
export function defaultComparePair(
  sets: readonly ProgressPhotoSet[],
): [string, string] | null {
  if (sets.length < 2) return null;
  return [sets[sets.length - 1]!.id, sets[0]!.id];
}

/**
 * The compared sets as [older, newer], whatever order they were picked in.
 * Ids no longer listed (a set the client deleted) fall back to the default.
 */
export function orderedComparePair(
  sets: readonly ProgressPhotoSet[],
  pair: readonly [string, string] | null,
): [ProgressPhotoSet, ProgressPhotoSet] | null {
  const fallback = defaultComparePair(sets);
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

export type CompareStrip = {
  weight: { from: string; to: string };
  bodyFat: { from: string; to: string };
  apart: { value: string; unit: "wk" | "d" };
};

/**
 * The strip under the compare (canvas "80.2 →82.4 · Weight kg"): weight in
 * the coach's unit, body fat, and weeks apart (days under a week).
 */
export function compareStrip(
  older: ProgressPhotoSet,
  newer: ProgressPhotoSet,
  toUnit: (kg: number) => number = (kg) => kg,
): CompareStrip {
  const days = Math.abs(daysBetween(older.takenOn, newer.takenOn));
  const weight = (s: ProgressPhotoSet) =>
    s.weight ? toUnit(s.weight.kg).toFixed(1) : "–";
  const fat = (s: ProgressPhotoSet) =>
    s.bodyFat ? s.bodyFat.percentage.toFixed(1) : "–";
  return {
    weight: { from: weight(older), to: weight(newer) },
    bodyFat: { from: fat(older), to: fat(newer) },
    apart:
      days < 7
        ? { value: String(days), unit: "d" }
        : { value: String(Math.round(days / 7)), unit: "wk" },
  };
}
