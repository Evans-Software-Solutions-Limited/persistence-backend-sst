import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import type { AthleteProgramDetail } from "@/domain/models/program";
import type { ApiError } from "@/shared/errors";
import { AthleteProgramPresenter } from "@/ui/presenters/AthleteProgramPresenter";

/**
 * <AthleteProgramContainer> — read-only athlete programme screen
 * (specs/19-programs — athlete view). Direct fetch of `GET /programs/:id`
 * (assignment-scoped, no local cache — a single derived read per visit,
 * mirroring ClientDetailContainer's active-programme fetch). Tapping a workout
 * opens its detail, where the athlete starts the session.
 */
export function AthleteProgramContainer({ programId }: { programId: string }) {
  const router = useRouter();
  const { api } = useAdapters();

  const [program, setProgram] = useState<AthleteProgramDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!programId) return;
      if (mode === "refresh") setIsRefreshing(true);
      const result = await api.getAthleteProgram(programId);
      if (result.ok) {
        setProgram(result.value);
        setError(null);
      } else {
        setError(result.error);
      }
      setIsLoading(false);
      setIsRefreshing(false);
    },
    [api, programId],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const onRefresh = useCallback(() => {
    void load("refresh");
  }, [load]);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const onOpenWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/workouts/${workoutId}` as never);
    },
    [router],
  );

  return (
    <AthleteProgramPresenter
      program={program}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      error={error}
      onRefresh={onRefresh}
      onBack={onBack}
      onOpenWorkout={onOpenWorkout}
    />
  );
}
