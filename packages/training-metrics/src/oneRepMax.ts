/**
 * Estimated one-rep max (Epley) from a completed weighted set, in kg. The
 * same formula as the phone's `domain/services/oneRepMax.ts`: sets with no
 * weight, or outside 1–10 reps, can't be estimated and return null.
 */
export function estimateOneRepMax(
  weightKg: number,
  reps: number,
): number | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > 10) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}
