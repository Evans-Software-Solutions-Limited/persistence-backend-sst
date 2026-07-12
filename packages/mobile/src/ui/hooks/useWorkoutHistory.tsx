import { useEffect, useRef, useState } from "react";
import type { WorkoutHistory } from "@/domain/models/workout";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * Per-workout completed-session history for the detail hero's market-standard
 * stats block (LAST DONE / COMPLETED × / AVG TIME + last-session recap).
 *
 * Online-direct (mirrors the coach AI-summary card): `GET /workouts/:id/history`
 * is a lightweight aggregate read, and the block is a non-critical stat panel —
 * when offline / errored / never-done the presenter simply renders nothing.
 * The workout detail itself stays cache-first via `useWorkout`; only this stat
 * overlay is fetched fresh. A `null` history (no result / offline) and the
 * empty-state history (`completedCount === 0`) both render as "no history yet".
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/requirements.md STORY-005 AC 5.2
 */

export type WorkoutHistoryState = {
  history: WorkoutHistory | null;
  isLoading: boolean;
  error: ApiError | null;
};

export function useWorkoutHistory(
  workoutId: string | null,
): WorkoutHistoryState {
  const { api } = useAdapters();
  const [history, setHistory] = useState<WorkoutHistory | null>(null);
  // Seed loading TRUE for a fetchable id so the first frame (before the fetch
  // effect runs) doesn't briefly render the "Not done yet" empty state for a
  // workout that actually has history. Null / optimistic `local-` ids never
  // fetch, so they start false.
  const [isLoading, setIsLoading] = useState<boolean>(
    () => !!workoutId && !workoutId.startsWith("local-"),
  );
  const [error, setError] = useState<ApiError | null>(null);

  // Track the workoutId a response belongs to so a slow fetch for a
  // previous workout can't overwrite the current one.
  const latestIdRef = useRef<string | null>(workoutId);
  useEffect(() => {
    latestIdRef.current = workoutId;
  }, [workoutId]);

  useEffect(() => {
    if (!workoutId) {
      setHistory(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    // Locally-created workouts (optimistic, id `local-…`) have never been
    // completed and don't exist server-side yet — skip the round-trip.
    if (workoutId.startsWith("local-")) {
      setHistory(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void (async () => {
      const result = await api.getWorkoutHistory(workoutId);
      if (cancelled || latestIdRef.current !== workoutId) return;
      if (result.ok) {
        setHistory(result.value);
      } else {
        // Non-fatal: the hero renders without the history block.
        setHistory(null);
        setError(result.error);
      }
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [api, workoutId]);

  return { history, isLoading, error };
}
