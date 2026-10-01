/** Resolve empty client rep fields identically for validation and persistence. */
export function resolveWorkoutRepRange(input: {
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
}): { targetRepsMin: number; targetRepsMax: number } {
  const min = input.targetRepsMin === 0 ? undefined : input.targetRepsMin;
  const max = input.targetRepsMax === 0 ? undefined : input.targetRepsMax;
  return {
    targetRepsMin: min ?? max ?? 8,
    targetRepsMax: max ?? min ?? 12,
  };
}
