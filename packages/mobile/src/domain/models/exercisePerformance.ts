export type PerformanceSetSource = {
  weightKg: number;
  reps: number;
  completedAt: string;
};

export type PerformanceEstimate = {
  estimateKg: number;
  source: PerformanceSetSource;
};

/** Current-user, exercise-scoped metrics returned as one extensible read model. */
export type ExercisePerformanceSummary = {
  estimatedOneRepMax: PerformanceEstimate | null;
  estimatedTenRepMax: PerformanceEstimate | null;
  tenRepMax: {
    weightKg: number;
    source: PerformanceSetSource;
  } | null;
  heaviestSet: {
    weightKg: number;
    source: PerformanceSetSource;
  };
  bestSetVolume: {
    volumeKg: number;
    source: PerformanceSetSource;
  };
  lifetimeVolumeKg: number;
};
