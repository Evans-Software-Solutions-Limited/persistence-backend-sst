import { hydrateTogetherCompletionSummary } from "@/adapters/together/hydrateCompletionSummary";
/**
 * SessionSummaryContainer — post-completion stats screen for the
 * `/(app)/session/summary` route. (M3, Story-006.)
 *
 * Reads the most recent session row (regardless of status) via
 * `storage.getLatestSession` — by the time the user lands here the
 * `WorkoutRatingContainer` has already fired
 * `completeSessionCommand`, so `getActiveSession` would return null.
 *
 * Renders the finish pages (PER-60 canvas row 3c) from the snapshot at
 * once: totals, exercises and volume from `buildWorkoutSummary`, muscles
 * from the cached exercise library. It then polls the `record_responses`
 * cache slot every 500ms until the sync worker drains `POST
 * /sessions/record`; the response adds the records page and the
 * "workouts this month" line. Workout details is a second view of the
 * same model.
 *
 * The Discard flow does NOT route through this screen — that's a
 * native `Alert.alert` on the active-session screen per legacy
 * (persistence-mobile/components/workouts/ActiveWorkoutModal.tsx:514).
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 *       Legacy reference: persistence-mobile/components/workouts/WorkoutSummaryScreen/WorkoutSummaryScreen.tsx
 */

import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateSummary } from "@/domain/services/sessionService";
import {
  buildWorkoutSummary,
  muscleShare,
  resolveMuscles,
  sessionMuscleInputs,
  type SummaryRecord,
} from "@/domain/services/workoutSummary";
import type { WorkoutSession } from "@/domain/models/session";
import type {
  RecordResponseSummary,
  RecordResponseSummaryPR,
} from "@/domain/ports/storage.port";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import {
  SessionSummaryPresenter,
  type SummaryTogether,
} from "@/ui/presenters/SessionSummaryPresenter";
import { WorkoutDetailsPresenter } from "@/ui/presenters/WorkoutDetailsPresenter";

// How often to recheck the cache slot for the bulk-record response.
// 500ms keeps the swap perceptually-instant on a normal connection
// (typical server round-trip is 200-500ms) without burning battery if
// the user lingers on the summary screen offline.
const POLL_INTERVAL_MS = 500;

export function SessionSummaryContainer() {
  const { storage, api } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const weightUnit = useProfilePage().payload?.profile.weightUnit ?? "kg";
  // The rating screen hands over the effort and, for Together, the roster:
  // by now the live session has closed, so neither can be read back.
  const params = useLocalSearchParams<{ rating?: string; together?: string }>();
  const rating = parseRating(params.rating);
  const together = useMemo(
    () => parseTogether(params.together),
    [params.together],
  );
  const [view, setView] = useState<"pages" | "details">("pages");

  // Snapshot the latest session as soon as auth resolves. We hold
  // it in state so `clearActiveSession` (called from Continue) can
  // wipe storage without our render going blank. Captured once per
  // userId — re-arms only on a real userId transition.
  const [snapshot, setSnapshot] = useState<WorkoutSession | null>(null);
  const capturedForUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    if (capturedForUserIdRef.current === userId) return;
    capturedForUserIdRef.current = userId;
    setSnapshot(storage.getLatestSession(userId));
  }, [userId, storage]);

  // Subscribe to the cached server response. Polled because the sync
  // worker writes asynchronously from a separate effect; no global
  // event bus today. Stops once `serverData != null`, so the
  // steady-state cost is one mount-time read.
  //
  // Inspector Brad PR #62 regression: gate the cache hit on
  // `localSessionId === snapshot.id`. The cache is keyed by userId
  // (single-active-session invariant), so when the sync worker
  // drains a FIFO queue containing a prior session's POST followed
  // by the current session's POST, the cache slot transiently
  // carries the prior session's data. Without the id check, the
  // poll fires between the two writes, captures the prior session's
  // payload, sets `serverData`, stops polling — and Session B
  // permanently renders Session A's PRs + count.
  const [serverData, setServerData] = useState<RecordResponseSummary | null>(
    null,
  );
  useEffect(() => {
    setServerData(null);
  }, [userId]);
  useEffect(() => {
    if (
      !userId ||
      !snapshot ||
      snapshot.userId !== userId ||
      serverData != null
    )
      return;
    const tick = () => {
      const cached = storage.getRecordResponse(userId);
      if (cached && cached.localSessionId === snapshot.id) {
        setServerData(cached);
      }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [userId, snapshot, serverData, storage]);

  useEffect(() => {
    const historyId = snapshot?.together?.historyId;
    if (
      !userId ||
      !snapshot ||
      snapshot.userId !== userId ||
      !historyId ||
      serverData
    )
      return;
    let active = true;
    let inFlight = false;
    const hydrate = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        await hydrateTogetherCompletionSummary({
          api,
          storage,
          userId,
          localSessionId: snapshot.id,
          historyId,
          isCurrent: () =>
            active &&
            currentUser.current === userId &&
            storage.getLatestSession(userId)?.id === snapshot.id,
        });
      } finally {
        inFlight = false;
      }
    };
    void hydrate();
    const timer = setInterval(() => {
      void hydrate();
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, storage, userId, snapshot, serverData]);

  // `n3b_cards` §5: records come from the server summary only; the page
  // stays hidden until the response lands.
  const records = useMemo<SummaryRecord[]>(
    () => serverData?.personalRecords.map(fromServerPR) ?? [],
    [serverData],
  );
  const model = useMemo(
    () =>
      snapshot
        ? buildWorkoutSummary(
            snapshot,
            calculateSummary(snapshot).duration,
            records,
          )
        : null,
    [snapshot, records],
  );
  const muscles = useMemo(() => {
    if (!snapshot) return muscleShare([]);
    const byId = new Map(
      storage.getCachedExercises().map((e) => [e.id, e] as const),
    );
    // Cached exercises carry catalogue UUIDs; the reference list names them.
    const names = new Map(
      (storage.getCachedReferenceList("muscle_groups")?.entries ?? []).map(
        (entry) => [entry.id, entry.name] as const,
      ),
    );
    return muscleShare(
      sessionMuscleInputs(snapshot, (exerciseId) => {
        const e = byId.get(exerciseId);
        return e
          ? {
              primary: resolveMuscles(
                e.primaryMuscleGroups,
                e.primaryMuscleGroupLabels,
                names,
              ),
              secondary: resolveMuscles(
                e.secondaryMuscleGroups,
                e.secondaryMuscleGroupLabels,
                names,
              ),
            }
          : null;
      }),
    );
  }, [snapshot, storage]);

  const onContinue = useCallback(() => {
    if (!userId) return;
    storage.clearActiveSession(userId);
    router.dismissAll();
  }, [userId, storage]);

  if (!snapshot || snapshot.userId !== userId || !model) {
    // Race: user navigated to /summary before any session existed. Bounce.
    return null;
  }

  if (view === "details")
    return (
      <WorkoutDetailsPresenter
        model={model}
        recordsCount={records.length}
        rating={rating}
        partners={together?.names}
        weightUnit={weightUnit}
        onBack={() => setView("pages")}
      />
    );
  return (
    <SessionSummaryPresenter
      model={model}
      muscles={muscles}
      records={records}
      workoutsThisMonth={serverData?.workoutsThisMonth ?? null}
      rating={rating}
      weightUnit={weightUnit}
      together={together}
      onDetails={() => setView("details")}
      onContinue={onContinue}
      onClose={onContinue}
    />
  );
}

function parseRating(raw: string | undefined): number | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** The roster the rating screen passed on; anything malformed is no roster. */
function parseTogether(raw: string | undefined): SummaryTogether | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SummaryTogether>;
    if (
      typeof v.self === "string" &&
      Array.isArray(v.names) &&
      v.names.every((n) => typeof n === "string") &&
      (v.connection === "Nearby" || v.connection === "Online")
    )
      return { self: v.self, names: v.names, connection: v.connection };
  } catch {
    // fall through
  }
  return null;
}

function fromServerPR(pr: RecordResponseSummaryPR): SummaryRecord {
  return {
    exerciseId: pr.exerciseId,
    exerciseName: pr.exerciseName,
    recordType: pr.recordType,
    newValue: pr.newValue,
    previousValue: pr.previousValue,
    setId: pr.setId,
  };
}
