/**
 * Estimate a one-repetition maximum from a completed weighted set.
 *
 * The UI decides how to round for the user's display unit. This service keeps
 * the canonical kilogram value so no precision is lost in cache or transport.
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
