/**
 * useResumeSession — app-launch active-session detector + dismissal
 * gate. (M3, Story-008.)
 *
 * Mounted once at the `(app)/_layout.tsx` root alongside
 * `useSyncWorker`. On mount, calls `resumeSessionCommand` to look up
 * any in-progress session. If one exists and the user hasn't already
 * dismissed the prompt this app-launch, returns it for the
 * `<ResumePrompt>` overlay. The `dismissed` flag lives in an in-memory
 * ref, NOT SQLite — the user is offered the prompt once per launch
 * (per EXECUTION_PLAN § 4 mitigation: prevents double-prompting on
 * tab switches that re-mount the layout).
 *
 * Spec: specs/05-active-session/requirements.md STORY-008
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 9
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { resumeSessionCommand } from "@/application/commands/session";
import type { WorkoutSession } from "@/domain/models/session";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

export type UseResumeSession = {
  session: WorkoutSession | null;
  dismiss: () => void;
};

export function useResumeSession(): UseResumeSession {
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  // Once dismissed this app-launch, never re-show — even on tab
  // switches that re-render the layout. Reset on userId change so
  // sign-out → sign-in re-arms the prompt.
  const dismissedRef = useRef(false);

  useEffect(() => {
    dismissedRef.current = false;
    if (!userId) {
      setSession(null);
      return;
    }
    if (dismissedRef.current) return;
    const resumed = resumeSessionCommand({ storage, userId });
    setSession(resumed);
  }, [storage, userId]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setSession(null);
  }, []);

  return { session, dismiss };
}
