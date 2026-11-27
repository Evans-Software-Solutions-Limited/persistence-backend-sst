import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { applyServerErrors, messageAt } from "@/lib/form";
import { isCoachApiError, newIdempotencyKey } from "../api/coachApi";
import type { LibraryPlan, RosterClient } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
} from "../hooks/coachQueries";
import { kcalText } from "../lib/mealPlans";
import { firstName } from "../lib/people";
import {
  NOTE_SERVER_FIELDS,
  noteResolver,
  type NoteValues,
} from "../lib/planForm";
import { SendPlanDialog } from "./SendPlanDialog";

/**
 * C5 Send (with a note) and C1b Change the note. The note is a
 * react-hook-form; the server trims it and keeps the final say (its 422 maps
 * onto the note). Send carries an `Idempotency-Key`, so a retry after a lost
 * reply doesn't send twice.
 */
export function SendPlanContainer({
  mode,
  plan,
  client,
  clients,
  assignmentId,
  initialNote,
  onDone,
  onClose,
}: {
  mode: "send" | "note";
  plan: LibraryPlan;
  /** The client, when known (client tab). */
  client: RosterClient | null;
  /** Library send: the active clients to choose from. */
  clients?: RosterClient[];
  /** Note mode: the assignment whose note changes. */
  assignmentId?: string;
  initialNote?: string | null;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const api = useCoachApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const [clientId, setClientId] = useState<string | null>(client?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const chosen = client ?? clients?.find((c) => c.id === clientId) ?? null;

  const form = useForm<NoteValues>({
    resolver: noteResolver,
    mode: "onChange",
    defaultValues: { note: initialNote ?? "" },
  });
  const note = form.watch("note");

  const target = useQuery({
    queryKey: coachKeys.clientMealPlans(clientId ?? ""),
    queryFn: () => api.clientMealPlans(clientId!),
    enabled: !!clientId && mode === "send",
    networkMode: COACH_NETWORK_MODE,
  });
  const t = target.data?.target ?? null;

  async function submit(values: NoteValues) {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const text = values.note.trim() || null;
    try {
      if (mode === "send") {
        await api.assignPlan(chosen.id, plan.id, text, key.current);
      } else {
        await api.patchAssignmentNote(chosen.id, assignmentId!, text);
      }
      await queryClient.invalidateQueries({
        queryKey: coachKeys.clientMealPlans(chosen.id),
      });
      const first = firstName(chosen.name);
      onDone(
        mode === "send" ? `Sent to ${first}` : `Note updated for ${first}`,
      );
    } catch (e) {
      if (applyServerErrors(e, form.setError, NOTE_SERVER_FIELDS)) return;
      setError(
        isCoachApiError(e) && e.offline
          ? "You’re offline. Try again when you’re back online."
          : isCoachApiError(e) && e.status === 404
            ? mode === "send"
              ? "This plan or client isn’t available any more."
              : "This plan isn’t with this client any more."
            : isCoachApiError(e)
              ? e.message
              : "We couldn’t send that. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SendPlanDialog
      mode={mode}
      planName={plan.name}
      versusTarget={
        t ? `${kcalText(plan.totals.kcal)} / ${kcalText(t.dailyKcal)}` : null
      }
      clientName={chosen?.name ?? null}
      clients={client ? null : (clients ?? [])}
      clientId={clientId}
      note={note}
      noteError={messageAt(form.formState.errors, "note") ?? null}
      busy={busy}
      offline={!online}
      error={error}
      onClient={(id) => {
        // A new client is a new send: a retry must never replay the key of
        // a send to someone else.
        if (id !== clientId) key.current = newIdempotencyKey();
        setClientId(id);
      }}
      onNote={(text) =>
        form.setValue("note", text, { shouldDirty: true, shouldValidate: true })
      }
      onSubmit={() => void form.handleSubmit(submit)()}
      onClose={onClose}
    />
  );
}
