import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError, newIdempotencyKey } from "../api/coachApi";
import { writeError } from "./writeError";
import { Dialog, Loading } from "../ui/parts";
import { useCalendarApi } from "./api";
import { refreshSchedule, useWorkoutOptions } from "./queries";
import {
  blankValues,
  isEmptyPatch,
  nextHour,
  scheduleResolver,
  sessionValues,
  toNewSession,
  toPatch,
  type ScheduleValues,
} from "./scheduleForm";
import { ScheduleSheet, type PickableClient } from "./ScheduleSheet";
import type { CoachSession, SessionKind, SessionScope } from "./types";

const CLIENT_KINDS: SessionKind[] = ["in_person", "video", "check_in_call"];
const ALL_KINDS: SessionKind[] = [...CLIENT_KINDS, "own_training"];

export type ScheduleTarget =
  | {
      mode: "create";
      /** From Client Detail (C4c): this client only. */
      client?: PickableClient;
      /** First suggested start; the next whole hour when absent. */
      start?: Date;
    }
  | { mode: "edit"; session: CoachSession };

/**
 * Schedule, or edit, a session (C4c, PER-144). Owns the form, the write and
 * the server's answers: 422/404 land on fields, a stale revision reloads the
 * calendar and says so, anything else shows in the sheet.
 */
export function ScheduleContainer({
  target,
  clients = [],
  onClose,
  onSaved,
}: {
  target: ScheduleTarget;
  clients?: PickableClient[];
  onClose: () => void;
  onSaved: (message: string, first: CoachSession) => void;
}) {
  const api = useCalendarApi();
  const queryClient = useQueryClient();
  const workouts = useWorkoutOptions();
  const isNew = target.mode === "create";
  const fixedClient = target.mode === "create" ? (target.client ?? null) : null;
  const editing = target.mode === "edit" ? target.session : null;
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [scope, setScope] = useState<SessionScope | null>(
    editing?.seriesId ? "this" : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The sheet opens once per target, so its starting values are fixed.
  const [defaults] = useState<ScheduleValues>(() =>
    editing
      ? sessionValues(editing)
      : blankValues({
          clientIds: fixedClient ? [fixedClient.id] : [],
          start:
            (target.mode === "create" ? target.start : undefined) ??
            nextHour(new Date()),
        }),
  );
  const form = useForm<ScheduleValues>({
    resolver: scheduleResolver(isNew),
    defaultValues: defaults,
  });

  const kinds = editing
    ? editing.kind === "own_training" || editing.attendees.length === 0
      ? ALL_KINDS
      : CLIENT_KINDS
    : fixedClient
      ? CLIENT_KINDS
      : ALL_KINDS;

  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const patch = toPatch(editing, values);
        if (isEmptyPatch(patch)) {
          onClose();
          return;
        }
        const res = await api.update(editing.id, patch, scope ?? "this");
        await refreshSchedule(queryClient);
        onSaved(
          scope === "series" && res.series.length > 1
            ? `${res.series.length} sessions updated`
            : "Session updated",
          res.data,
        );
      } else {
        const res = await api.create(toNewSession(values), idempotencyKey);
        await refreshSchedule(queryClient);
        onSaved(
          res.series.length > 1
            ? `${res.series.length} sessions scheduled`
            : "Session scheduled",
          res.data,
        );
      }
    } catch (e) {
      setError(writeError(e, form));
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        await refreshSchedule(queryClient);
      }
    } finally {
      setBusy(false);
    }
  });

  // The workout select is uncontrolled: on Edit it must mount with its
  // options, or it shows "None" and the linked workout is lost.
  if (editing && workouts.isPending) {
    return (
      <Dialog title="Edit session" onClose={onClose}>
        <Loading />
      </Dialog>
    );
  }

  return (
    <ScheduleSheet
      form={form}
      mode={target.mode}
      kinds={kinds}
      fixedClient={fixedClient}
      clients={clients}
      bookedNames={
        editing
          ? editing.attendees
              .filter((a) => a.status !== "cancelled")
              .map((a) => a.name)
          : []
      }
      workouts={workouts.data ?? []}
      linkedWorkout={editing?.workout ?? null}
      scope={scope}
      onScope={setScope}
      busy={busy}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  );
}
