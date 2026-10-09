import { useDiscardWorkout } from "@/ui/hooks/useDiscardWorkout";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useActiveWorkout } from "@/state/active-workout";
import { TogetherAdmissionRecoveryPresenter } from "@/ui/presenters/TogetherAdmissionRecoveryPresenter";
import { TogetherRecoveryPresenter } from "@/ui/presenters/TogetherRecoveryPresenter";
import type { TogetherWorkoutReview } from "@/domain/ports/togetherWorkout.port";
import type { TogetherCloudState } from "@/domain/ports/togetherCloud.port";
const EMPTY: TogetherCloudState = {
  phase: "idle" as const,
  requests: [],
  previous: {},
  pendingCount: 0,
};
export function TogetherCloudRecoveryContainer() {
  const { togetherCloud: cloud, storage } = useAdapters();
  const { session: auth } = useAuth();
  const userId = auth?.userId;
  const params = useLocalSearchParams<{
    localSessionId?: string;
    mode?: string;
  }>();
  const insets = useSafeAreaInsets();
  const confirmDiscard = useDiscardWorkout(userId, params.localSessionId);
  const state = useSyncExternalStore(
    (l) => cloud?.subscribe(l) ?? (() => {}),
    () => cloud?.getSnapshot() ?? EMPTY,
  );
  const scope = useMemo(
    () => ({ cloud, userId, id: params.localSessionId }),
    [cloud, userId, params.localSessionId],
  );
  const latest = useRef(scope);
  latest.current = scope;
  const mounted = useRef(false),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [review, setReview] = useState<TogetherWorkoutReview | null>(null);
  useEffect(() => {
    mounted.current = true;
    locked.current = false;
    setReview(null);
    setBusy(false);
    setError("");
    return () => {
      mounted.current = false;
    };
  }, [scope]);
  const current = () => mounted.current && latest.current === scope;
  const draft = userId ? cloud?.readDraft(userId) : null;
  const valid =
    !!cloud && !!userId && !!draft && draft.id === params.localSessionId;
  const run = (action: () => Promise<void>) => {
    if (!valid || locked.current || !current()) return;
    locked.current = true;
    setBusy(true);
    setError("");
    void Promise.resolve()
      .then(() => (current() ? action() : undefined))
      .catch((e) => {
        if (current())
          setError(
            e instanceof Error
              ? `Could not save this review (${e.message}). Your own workout remains on this device.`
              : "Could not save this review. Your workout remains on this device.",
          );
      })
      .finally(() => {
        if (current()) {
          locked.current = false;
          setBusy(false);
        }
      });
  };
  const prepare = () =>
    run(async () => {
      const candidate = await cloud!.prepareReview();
      if (!current()) return;
      const s = cloud!.getSnapshot().snapshot;
      if (!s) throw new Error("session-unavailable");
      const own = s.participants.find((p) => p.userId === userId);
      if (!own) throw new Error("account-changed");
      setReview({
        status: "stored_for_review",
        sharingActive: false,
        historySaved: false,
        sessionId: s.sessionId,
        executionId: draft!.together!.executionId,
        revision: own.ownRevision,
        startedAt: Date.parse(draft!.startedAt),
        plan: candidate.plan,
        execution: candidate.execution,
        snapshotToken: candidate.token,
        omissions: candidate.omissions,
        retainedLocalChanges: candidate.retainedLocalChanges,
      });
    });
  const save = () => {
    const shown = review;
    if (!shown) return;
    run(async () => {
      const s = cloud!.getSnapshot().snapshot;
      if (!s) throw new Error("session-unavailable");
      if (!s.sharingActive)
        await cloud!.reviewOwn(shown.execution, shown.snapshotToken);
      else if (params.mode === "finish_all" || params.mode === "save_own")
        await cloud!.close(params.mode, shown.snapshotToken);
      else if (params.mode === "leave") await cloud!.leave(shown.snapshotToken);
      else await cloud!.finish(shown.snapshotToken);
      if (!current()) return;
      const result = cloud!
        .getSnapshot()
        .snapshot?.participants.find((p) => p.userId === userId);
      if (
        !result ||
        (result.status !== "saved" && result.status !== "finished_empty")
      )
        throw new Error("result-not-confirmed");
      setReview({
        ...shown,
        status: result.status,
        historySaved: result.status === "saved",
        historyId: result.historyId,
      });
    });
  };
  const done = () =>
    run(async () => {
      const fresh = cloud!.readDraft(userId!);
      if (fresh?.status === "in_progress") {
        router.back();
        return;
      }
      const base = storage.getLatestSession(userId!);
      if (base?.id === draft?.id) storage.clearActiveSession(userId!);
      if (useActiveWorkout.getState().active?.sessionId === draft?.id)
        await useActiveWorkout.getState().end();
      if (current()) {
        storage.invalidateDashboard(userId!);
        router.dismissAll();
      }
    });
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View gap={16}>
        {params.mode === "finish_all" && (
          <Text fontFamily="$body" color="$text2">
            End for everyone saves only the work already acknowledged by the
            server. Unsent work remains on each athlete’s phone for their own
            review.
          </Text>
        )}
        {state.pendingCount > 0 && (
          <Text fontFamily="$body" color="$text2">
            {state.pendingCount}{" "}
            {state.pendingCount === 1 ? "change is" : "changes are"} still
            waiting to sync. Review must account for your local work before
            finishing.
          </Text>
        )}
        {valid && !state.snapshot ? (
          <TogetherAdmissionRecoveryPresenter
            canContinuePersonally={!!state.canDetachDraft}
            busy={busy}
            error={error}
            onContinuePersonally={() =>
              run(async () => {
                cloud!.detachDraft(userId!, (personal) => {
                  if (!current() || personal.userId !== userId)
                    throw new Error("account-changed");
                  const existing = storage.getLatestSession(userId!);
                  if (existing && existing.id !== personal.id)
                    throw new Error("workout-changed");
                  storage.cacheActiveSession(userId!, personal);
                });
                if (current()) router.back();
              })
            }
            onRetry={() =>
              run(async () => {
                await cloud!.retry();
              })
            }
            onDiscard={confirmDiscard}
            onBack={() => router.back()}
          />
        ) : (
          <TogetherRecoveryPresenter
            name={draft?.name ?? "My workout"}
            available={valid}
            review={review}
            busy={busy}
            error={
              valid
                ? error
                : "This account’s cloud workout is unavailable. Your saved local work has not been deleted."
            }
            exerciseNames={Object.fromEntries(
              draft?.exercises.map((e) => [e.exerciseId, e.exerciseName]) ?? [],
            )}
            onReview={prepare}
            onSave={save}
            onDiscard={confirmDiscard}
            onBack={() => router.back()}
            onDone={done}
          />
        )}
      </View>
    </ScrollView>
  );
}
