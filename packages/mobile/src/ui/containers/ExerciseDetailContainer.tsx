import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Alert, Linking } from "react-native";

import { ExerciseDetailPresenter } from "@/ui/presenters/ExerciseDetailPresenter";
import { useAuth } from "@/ui/hooks/useAuth";
import { useExercise } from "@/ui/hooks/useExercise";
import { useExercisePerformanceSummary } from "@/ui/hooks/useExercisePerformanceSummary";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useGetPRHistory } from "@/ui/hooks/useGetPRHistory";

/**
 * <ExerciseDetailContainer> — wires the `/(app)/exercises/[id]` route to the
 * cache-first `useExercise` read. Pushed from the Train > Exercises list
 * (and stacked under a workout when an exercise is opened from a workout's
 * detail), so Back returns to whatever pushed it.
 *
 * Ownership = `exercise.createdBy === session.userId`; only owners see the Edit
 * affordance (AC 7.3) and only owners can open the editor route.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007
 */
export function ExerciseDetailContainer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = id ?? null;
  const { api } = useAdapters();
  const { exercise, isLoading, error, refresh } = useExercise(exerciseId);
  const performance = useExercisePerformanceSummary(exerciseId);
  const profile = useProfilePage();
  // The server applies this limit after exercise scoping. Filtering a global
  // top-N list here made long-standing records disappear once other exercises
  // produced enough newer PRs.
  const prHistory = useGetPRHistory(50, exerciseId);
  const { session } = useAuth();
  const trackedEstimateRef = useRef<string | null>(null);

  useEffect(() => {
    const oneRepMax = performance.data?.estimatedOneRepMax;
    if (!exerciseId || !oneRepMax) return;
    const key = `${exerciseId}:${oneRepMax.estimateKg}`;
    if (trackedEstimateRef.current === key) return;
    trackedEstimateRef.current = key;
    void api.trackAnalyticsEvent({ name: "estimated_1rm_banner_viewed" });
  }, [api, exerciseId, performance.data?.estimatedOneRepMax]);

  const isOwner =
    exercise !== null &&
    exercise.createdBy !== null &&
    exercise.createdBy === session?.userId;

  const onClose = useCallback(() => router.back(), []);
  // Only rendered behind the owner+exercise gate (`isOwner` requires a loaded
  // exercise, which requires a non-null id), so `exerciseId` is always set here.
  const onEdit = useCallback(() => {
    router.push(`/(app)/exercises/${exerciseId}/edit` as never);
  }, [exerciseId]);
  const onRetry = useCallback(() => {
    void refresh();
  }, [refresh]);
  const onOpenVideo = useCallback(() => {
    if (!exercise?.videoUrl) return;
    void Linking.openURL(exercise.videoUrl).catch(() => {
      Alert.alert("Couldn't open video", "Please try again later.");
    });
  }, [exercise?.videoUrl]);

  return (
    <ExerciseDetailPresenter
      exercise={exercise}
      isLoading={isLoading}
      error={error}
      isOwner={isOwner}
      onClose={onClose}
      onEdit={onEdit}
      onOpenVideo={onOpenVideo}
      onRetry={onRetry}
      performanceSummary={performance.data}
      weightUnit={profile.payload?.profile.weightUnit ?? "kg"}
      personalRecords={prHistory.data ?? []}
    />
  );
}
