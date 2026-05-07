/**
 * SessionSummaryContainer — save-only summary screen for the
 * `/(app)/session/summary` route. (M3, Story-006.)
 *
 * Reads the active session from SQLite, computes
 * `sessionService.calculateSummary` + `detectPersonalRecords` against
 * the cached `personal_records` slice (predictive PR detection per
 * design.md § hybrid). Save → `completeSessionCommand` → dismiss the
 * modal stack.
 *
 * The Discard flow does NOT route through this screen — that's a
 * native `Alert.alert` on the active-session screen per legacy
 * (persistence-mobile/components/workouts/ActiveWorkoutModal.tsx:514).
 * PR / volume / completion stats only ever render after a successful
 * save.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 8
 */

import { router } from "expo-router";
import { useCallback, useMemo } from "react";
import { completeSessionCommand } from "@/application/commands/session";
import {
  calculateSummary,
  detectPersonalRecords,
} from "@/domain/services/sessionService";
import type { SessionSummary } from "@/domain/models/session";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
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
  const { session, userId } = useActiveSession();

  const generateId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  // Predictive PR detection runs against the locally-cached
  // `personal_records` slice — populated by `getPersonalRecords` on
  // home-tab focus. Server reconciles on flush.
  const summary = useMemo<SessionSummary>(() => {
    if (!session || !userId) return EMPTY_SUMMARY;
    const base = calculateSummary(session);
    const previousRecords = storage.getPersonalRecords(userId);
    const personalRecords = detectPersonalRecords(
      session,
      previousRecords,
      { userId, now: new Date().toISOString() },
      generateId,
    );
    return { ...base, personalRecords };
  }, [session, userId, storage, generateId]);

  const onSave = useCallback(() => {
    if (!userId) return;
    completeSessionCommand({ storage, userId });
    // Modal stack collapses to whatever pushed the session — typically
    // the workouts tab.
    router.dismissAll();
  }, [userId, storage]);

  const onClose = useCallback(() => {
    router.back();
  }, []);

  if (!session) {
    // Race: user navigated to /summary before the active session was
    // staged. Bounce back rather than render an empty stat card grid.
    return null;
  }

  return (
    <SessionSummaryPresenter
      summary={summary}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
