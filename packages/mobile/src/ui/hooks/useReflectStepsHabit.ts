import { useEffect } from "react";
import { localIdFactory } from "@/application/commands/localId";
import { reflectStepsHabit } from "@/application/commands/steps-habit-bridge.command";
import { localDayISO } from "@/shared/utils";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Reactively bridges today's HealthKit step count into the Steps HABIT
 * completion (BRIEF-7 QA-1..QA-4). Unlike water/sleep, steps has no explicit
 * "log" user action — it's a passive device read (`useHealthData().stepsToday`,
 * refreshed on mount/foreground/focus) — so this hook IS the trigger point:
 * mount it wherever steps is already read reactively (HomeContainer), keyed
 * on the steps value itself.
 *
 * Best-effort + offline-safe: `reflectStepsHabit` only writes to the local
 * cache + sync queue (no direct network call), and is idempotent — re-running
 * with the same steps value after the day is already ticked/un-ticked is a
 * no-op, so a HealthKit read that fires repeatedly through the day (each
 * foreground / focus / rate-limited poll) never double-writes.
 */
export function useReflectStepsHabit(steps: number | null): void {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  useEffect(() => {
    if (!userId || steps == null) return;
    reflectStepsHabit(
      { storage, userId, idFactory: localIdFactory },
      localDayISO(),
      steps,
    );
  }, [storage, userId, steps]);
}
