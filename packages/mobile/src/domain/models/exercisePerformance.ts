/** Current-user, exercise-scoped best qualifying set returned by the API. */
export type EstimatedOneRepMax = {
  estimateKg: number;
  source: {
    weightKg: number;
    reps: number;
    completedAt: string;
  };
};
