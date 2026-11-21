import { useMemo, useRef, useState } from "react";
import { Share } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { RecordResponseSummaryPR } from "@/domain/ports/storage.port";
import type { WorkoutSession } from "@/domain/models/session";
import {
  buildWorkoutSummary,
  muscleShare,
  sessionMuscleInputs,
  type SummaryRecord,
} from "@/domain/services/workoutSummary";
import { sessionTotals } from "@/domain/services/youPage";
import {
  remoteWorkout,
  remoteWorkoutRecords,
} from "@/application/queries/youRemote";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useTrainingLog } from "@/ui/hooks/useTrainingLog";
import { SessionSummaryPresenter } from "@/ui/presenters/SessionSummaryPresenter";
import { WorkoutDetailsPresenter } from "@/ui/presenters/WorkoutDetailsPresenter";

/** A workout's own record response entry as a summary record. */
export function toSummaryRecord(r: RecordResponseSummaryPR): SummaryRecord {
  return {
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    recordType: r.recordType,
    newValue: r.newValue,
    previousValue: r.previousValue,
    setId: r.setId,
  };
}

/**
 * <HistoryWorkoutContainer> — Y2b (PER-141): History → a past workout opens
 * the same end-of-workout carousel (`SessionSummaryPresenter`, PER-85 / row
 * 3c), from the phone's training log. Differences from the finish flow, per
 * the canvas: Close (×) instead of Continue, and the workout's name in the
 * top bar. Close returns to the same History day.
 *
 * The effort rating isn't stored with a finished workout on the phone, so
 * the totals page shows no effort chip here.
 */
export function HistoryWorkoutContainer() {
  const { id, at } = useLocalSearchParams<{ id?: string; at?: string }>();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const unit = useProfilePage().payload?.profile.weightUnit ?? "kg";
  // Read only the day the workout started (History passes it), not the
  // whole log.
  const range = useMemo(() => {
    const t = at ? Date.parse(at) : NaN;
    return Number.isFinite(t)
      ? { from: new Date(t - 86_400_000), to: new Date(t + 86_400_000) }
      : undefined;
  }, [at]);
  const log = useTrainingLog(userId, range);
  const [view, setView] = useState<"pages" | "details">("pages");

  // The sync can rename an offline workout (`local-…` → server id) while
  // this modal is open. Follow the rename by the workout's start, and never
  // drop a workout once shown: a blank modal has no Close button.
  const shown = useRef<WorkoutSession | null>(null);
  const workout = useMemo(() => {
    const prev = shown.current;
    const found =
      log.sessions.find((s) => s.id === id) ??
      (prev
        ? log.sessions.find((s) => s.startedAt === prev.startedAt)
        : null) ??
      // A workout History read from the server (BE-H1): an older month or
      // a new phone, never in this phone's log.
      remoteWorkout(id);
    shown.current = found ?? prev;
    return shown.current;
  }, [log.sessions, id]);
  // The workout's own records, "was" values included, as the finish shows.
  const records = useMemo(() => {
    const own =
      log.recordsBySession[workout?.id ?? ""] ?? log.recordsBySession[id ?? ""];
    // A workout read from the server carries its records with it.
    return own ? own.map(toSummaryRecord) : remoteWorkoutRecords(workout?.id);
  }, [log.recordsBySession, id, workout?.id]);
  const model = useMemo(
    () =>
      workout
        ? buildWorkoutSummary(
            workout,
            sessionTotals(workout).durationSeconds,
            records,
          )
        : null,
    [workout, records],
  );
  const muscles = useMemo(
    () =>
      muscleShare(workout ? sessionMuscleInputs(workout, log.musclesOf) : []),
    [workout, log.musclesOf],
  );

  if (!model) return null;

  const close = () => router.back();
  const share = (message: string) => {
    void Share.share({ message }).catch(() => {});
  };

  if (view === "details")
    return (
      <WorkoutDetailsPresenter
        model={model}
        recordsCount={records.length}
        rating={null}
        weightUnit={unit}
        onBack={() => setView("pages")}
        onShare={share}
      />
    );
  return (
    <SessionSummaryPresenter
      model={model}
      muscles={muscles}
      records={records}
      workoutsThisMonth={null}
      rating={null}
      weightUnit={unit}
      title={model.name}
      onDetails={() => setView("details")}
      onClose={close}
      onShare={share}
    />
  );
}
