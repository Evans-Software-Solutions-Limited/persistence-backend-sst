import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView } from "react-native";
import { View } from "@tamagui/core";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useActiveWorkout } from "@/state/active-workout";
import { TogetherRecoveryPresenter } from "@/ui/presenters/TogetherRecoveryPresenter";

export function TogetherRecoveryContainer() {
  const params = useLocalSearchParams<{ localSessionId?: string | string[] }>();
  const localSessionId =
    typeof params.localSessionId === "string"
      ? params.localSessionId
      : undefined;
  const { togetherLobby, storage } = useAdapters();
  const { session: auth } = useAuth();
  const userId = auth?.userId;
  const workout = togetherLobby?.workout;
  const scope = useMemo(
    () => ({ workout, userId, localSessionId }),
    [workout, userId, localSessionId],
  );
  const latest = useRef(scope);
  latest.current = scope;
  const mounted = useRef(false),
    locked = useRef(false);
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    mounted.current = true;
    locked.current = false;
    setBusy(false);
    setError("");
    setUnavailable(false);
    const unsubscribe = workout?.subscribe(() => {
      if (latest.current === scope && mounted.current) refresh((v) => v + 1);
    });
    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
  }, [scope, workout]);
  const current = () => mounted.current && latest.current === scope;
  const draft =
    userId && localSessionId ? workout?.read(userId, localSessionId) : null;
  const review =
    userId && localSessionId
      ? (workout?.getReview(userId, localSessionId) ?? null)
      : null;
  const available =
    !!workout && !!userId && !!localSessionId && !!draft && !unavailable;
  const availabilityError = !userId
    ? "Sign in to review your own workout."
    : !workout
      ? "Together recovery is unavailable in this app version. Your workout remains on this device."
      : !localSessionId
        ? "Choose a Together workout to review."
        : !draft
          ? "This workout is not available for this account."
          : "";
  const invoke = (save: boolean) => {
    if (
      !current() ||
      !available ||
      !workout ||
      !userId ||
      !localSessionId ||
      locked.current ||
      (save && !review)
    )
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    // Keep the exact token shown on screen. A newer unseen review must never be accepted.
    void Promise.resolve()
      .then(() => {
        if (!current()) return;
        return save
          ? workout.finish(
              userId,
              localSessionId,
              review!.revision,
              review!.snapshotToken,
            )
          : workout.review(userId, localSessionId);
      })
      .catch((e: unknown) => {
        if (!current()) return;
        const message = e instanceof Error ? e.message : "";
        if (message === "recovery-unavailable") {
          setUnavailable(true);
          setError(
            "Together recovery is unavailable in this app version. Your workout remains on this device.",
          );
        } else
          setError(
            /changed|VERSION|conflict/i.test(message)
              ? "Your workout changed. Refresh and review it again before saving."
              : /key/i.test(message)
                ? "The original device key is unavailable. Your workout remains on this device."
                : "Could not confirm your result. Your workout remains on this device; reconnect and refresh the review to check before trying again.",
          );
      })
      .finally(() => {
        if (current()) {
          locked.current = false;
          setBusy(false);
          refresh((v) => v + 1);
        }
      });
  };
  const done = () => {
    if (
      !current() ||
      !workout ||
      !userId ||
      !localSessionId ||
      locked.current ||
      (review?.status !== "saved" && review?.status !== "finished_empty")
    )
      return;
    const confirmed = workout.getReview(userId, localSessionId);
    if (
      !confirmed ||
      confirmed.snapshotToken !== review.snapshotToken ||
      (confirmed.status !== "saved" && confirmed.status !== "finished_empty")
    )
      return;
    locked.current = true;
    setBusy(true);
    try {
      if (confirmed.retainedLocalChanges) {
        router.replace("/(app)/session" as never);
        return;
      }
      // A later personal workout must not be cleared by an older recovery screen.
      if (storage.getLatestSession(userId)?.id === localSessionId)
        storage.clearActiveSession(userId);
      if (useActiveWorkout.getState().active?.sessionId === localSessionId)
        void useActiveWorkout.getState().end();
      storage.invalidateDashboard(userId);
      router.dismissAll();
    } catch {
      locked.current = false;
      setBusy(false);
      setError(
        "Your result is saved, but the local workout could not be closed. Try Continue again.",
      );
    }
  };
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      paddingBottom={insets.bottom}
    >
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <TogetherRecoveryPresenter
          name={draft?.name ?? "Together workout"}
          review={review}
          busy={busy}
          available={available}
          error={error || availabilityError}
          exerciseNames={Object.fromEntries(
            draft?.exercises.map((e) => [e.exerciseId, e.exerciseName]) ?? [],
          )}
          onReview={() => invoke(false)}
          onSave={() => invoke(true)}
          onBack={() => router.back()}
          onDone={done}
        />
      </ScrollView>
    </View>
  );
}
