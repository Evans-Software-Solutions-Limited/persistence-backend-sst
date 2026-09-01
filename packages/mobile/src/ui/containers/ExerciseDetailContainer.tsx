import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Alert, Linking } from "react-native";

import { ExerciseDetailPresenter } from "@/ui/presenters/ExerciseDetailPresenter";
import { useAuth } from "@/ui/hooks/useAuth";
import { useExercise } from "@/ui/hooks/useExercise";
import { useEstimatedOneRepMax } from "@/ui/hooks/useEstimatedOneRepMax";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { isExperiencePolishEnabled } from "@/ui/state/experiencePolish";
import { useAdapters } from "@/ui/hooks/useAdapters";

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
  const oneRepMax = useEstimatedOneRepMax(
    exerciseId,
    isExperiencePolishEnabled(),
  );
  const profile = useProfilePage();
  const { session } = useAuth();
  const trackedEstimateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!exerciseId || !oneRepMax.data) return;
    const key = `${exerciseId}:${oneRepMax.data.estimateKg}`;
    if (trackedEstimateRef.current === key) return;
    trackedEstimateRef.current = key;
    void api.trackAnalyticsEvent({ name: "estimated_1rm_banner_viewed" });
  }, [api, exerciseId, oneRepMax.data]);

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
      estimatedOneRepMax={oneRepMax.data}
      weightUnit={profile.payload?.profile.weightUnit ?? "kg"}
    />
  );
}
