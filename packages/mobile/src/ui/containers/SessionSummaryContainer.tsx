/**
 * SessionSummaryContainer — post-completion stats screen for the
 * `/(app)/session/summary` route. (M3, Story-006.)
 *
 * Reads the most recent session row (regardless of status) via
 * `storage.getLatestSession` — by the time the user lands here the
 * `WorkoutRatingContainer` has already fired
 * `completeSessionCommand`, so `getActiveSession` would return null.
 *
 * Two-phase render (Phase 3b "α cache-and-subscribe"):
 *
 *   1. Mount: build a LOCAL prediction summary via
 *      `calculateSummary` + `detectPersonalRecords` against the
 *      cached `personal_records` slice. The screen is interactive
 *      immediately; no network blocking.
 *
 *   2. Poll the `record_responses` cache slot every 500ms until the
 *      sync worker drains `POST /sessions/record` and writes the
 *      augmented response (PRs with `previousValue` + the
 *      `workoutsThisMonth` count). When it lands, the merged summary
 *      swaps the local PR list for the server-canonical one and the
 *      "Workouts this month" tile + subtitle copy go from placeholder
 *      to real number. Poll stops once captured.
 *
 * The Discard flow does NOT route through this screen — that's a
 * native `Alert.alert` on the active-session screen per legacy
 * (persistence-mobile/components/workouts/ActiveWorkoutModal.tsx:514).
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 *       Legacy reference: persistence-mobile/components/workouts/WorkoutSummaryScreen/WorkoutSummaryScreen.tsx
 */

import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateSummary,
  detectPersonalRecords,
} from "@/domain/services/sessionService";
import type { SessionSummary, WorkoutSession } from "@/domain/models/session";
import type {
  RecordResponseSummary,
  RecordResponseSummaryPR,
} from "@/domain/ports/storage.port";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { SessionSummaryPresenter } from "@/ui/presenters/SessionSummaryPresenter";

const EMPTY_SUMMARY: SessionSummary = {
  duration: 0,
  totalVolume: 0,
  exercisesCompleted: 0,
  totalExercises: 0,
  setsCompleted: 0,
  totalSets: 0,
  personalRecords: [],
};

// How often to recheck the cache slot for the bulk-record response.
// 500ms keeps the swap perceptually-instant on a normal connection
// (typical server round-trip is 200-500ms) without burning battery if
// the user lingers on the summary screen offline.
const POLL_INTERVAL_MS = 500;

export function SessionSummaryContainer() {
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;

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
    if (!userId || !snapshot || serverData != null) return;
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

  const generateId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  // Local prediction — runs against the cached `personal_records`
  // slice. The Summary screen renders this immediately on mount so
  // there's no "blank during sync" flash on a slow network.
  const localSummary = useMemo<SessionSummary>(() => {
    if (!snapshot || !userId) return EMPTY_SUMMARY;
    const base = calculateSummary(snapshot);
    const previousRecords = storage.getPersonalRecords(userId);
    const personalRecords = detectPersonalRecords(
      snapshot,
      previousRecords,
      { userId, now: new Date().toISOString() },
      generateId,
    );
    return { ...base, personalRecords };
  }, [snapshot, userId, storage, generateId]);

  // Merge local + server into the presenter's display shape. Server
  // wins for `personalRecords` (carries `previousValue` for the
  // before→after arrow) + `workoutsThisMonth`; local fills the
  // duration / totalVolume which the server doesn't surface (they're
  // session-scoped, computable client-side).
  const displayPersonalRecords = useMemo<SummaryPersonalRecord[]>(() => {
    if (serverData) {
      return serverData.personalRecords.map(fromServerPR);
    }
    // Pre-server fallback: local prediction renders without the
    // before→after arrow because we don't know `previousValue` until
    // the server tells us. Legacy WorkoutSummaryScreen handles the
    // same null case at line 83-91 — falls through to just the new
    // value.
    return localSummary.personalRecords.map(fromLocalPR);
  }, [serverData, localSummary]);

  const workoutsThisMonth = serverData?.workoutsThisMonth ?? null;
  const recordsHit = displayPersonalRecords.length;

  const onContinue = useCallback(() => {
    if (!userId) return;
    storage.clearActiveSession(userId);
    router.dismissAll();
  }, [userId, storage]);

  const onClose = useCallback(() => {
    if (!userId) return;
    storage.clearActiveSession(userId);
    router.dismissAll();
  }, [userId, storage]);

  if (!snapshot) {
    // Race: user navigated to /summary before any session existed. Bounce.
    return null;
  }

  return (
    <SessionSummaryPresenter
      totalVolume={localSummary.totalVolume}
      personalRecords={displayPersonalRecords}
      recordsHit={recordsHit}
      workoutsThisMonth={workoutsThisMonth}
      onSave={onContinue}
      onClose={onClose}
    />
  );
}

/**
 * Display-tier PR row consumed by the presenter. Distinct from the
 * domain `PersonalRecord` because (a) we don't need `id` / `userId` /
 * `achievedAt` / `sessionId` here, and (b) `previousValue` is null
 * during the local-prediction phase — there's no baseline to render
 * until the server response lands.
 */
export type SummaryPersonalRecord = {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordResponseSummaryPR["recordType"];
  newValue: number;
  previousValue: number | null;
};

function fromServerPR(pr: RecordResponseSummaryPR): SummaryPersonalRecord {
  return {
    exerciseId: pr.exerciseId,
    exerciseName: pr.exerciseName,
    recordType: pr.recordType,
    newValue: pr.newValue,
    previousValue: pr.previousValue,
  };
}

function fromLocalPR(pr: {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordResponseSummaryPR["recordType"];
  value: number;
}): SummaryPersonalRecord {
  return {
    exerciseId: pr.exerciseId,
    exerciseName: pr.exerciseName,
    recordType: pr.recordType,
    newValue: pr.value,
    previousValue: null,
  };
}
