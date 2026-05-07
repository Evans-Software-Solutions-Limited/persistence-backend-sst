/**
 * SessionSummaryContainer — post-completion stats screen for the
 * `/(app)/session/summary` route. (M3, Story-006.)
 *
 * Reads the most recent session row (regardless of status) via
 * `storage.getLatestSession` — by the time the user lands here the
 * `WorkoutRatingContainer` has already fired
 * `completeSessionCommand`, so `getActiveSession` would return null.
 * Computes `sessionService.calculateSummary` +
 * `detectPersonalRecords` against the cached `personal_records`
 * slice (predictive PR detection per design.md § hybrid).
 *
 * Continue → clears the local session row + collapses the modal stack
 * back to whatever pushed the session.
 *
 * The Discard flow does NOT route through this screen — that's a
 * native `Alert.alert` on the active-session screen per legacy
 * (persistence-mobile/components/workouts/ActiveWorkoutModal.tsx:514).
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 */

import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateSummary,
  detectPersonalRecords,
} from "@/domain/services/sessionService";
import type { SessionSummary, WorkoutSession } from "@/domain/models/session";
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

  const generateId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  // Predictive PR detection runs against the locally-cached
  // `personal_records` slice — populated by `getPersonalRecords` on
  // home-tab focus. Server reconciles on flush.
  const summary = useMemo<SessionSummary>(() => {
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

  const onContinue = useCallback(() => {
    if (userId) storage.clearActiveSession(userId);
    router.dismissAll();
  }, [userId, storage]);

  const onClose = useCallback(() => {
    if (userId) storage.clearActiveSession(userId);
    router.dismissAll();
  }, [userId, storage]);

  if (!snapshot) {
    // Race: user navigated to /summary before any session existed. Bounce.
    return null;
  }

  return (
    <SessionSummaryPresenter
      summary={summary}
      onSave={onContinue}
      onClose={onClose}
    />
  );
}
