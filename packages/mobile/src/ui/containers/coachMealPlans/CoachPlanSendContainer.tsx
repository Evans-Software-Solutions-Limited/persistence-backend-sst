import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { localIdFactory } from "@/application/commands/localId";
import type { CoachClientTarget } from "@/domain/models/coachMealPlans";
import type { NutritionPlan } from "@/domain/models/nutritionPlans";
import type { TrainerClient } from "@/domain/models/trainerClient";
import { firstName, kcalText } from "@/domain/services/coachMealPlans.service";
import { messageAt } from "@/shared/form";
import {
  NOTE_MESSAGE,
  coachNoteResolver,
  type CoachNoteValues,
} from "@/ui/forms/coachPlanForms";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  PickerSheetPresenter,
  SendPlanSheetPresenter,
} from "@/ui/presenters/coachMealPlans/CoachPlanSheets";

export const SEND_FAILED = "We couldn’t send that. Try again.";
export const GONE = "This plan or client isn’t available any more.";

/**
 * C5 Send (a note, no days) and C1b Change the note, on the phone. The note
 * is a react-hook-form; Send carries one `Idempotency-Key` per sheet, so a
 * retry never sends twice. Both need a connection.
 */
export function CoachPlanSendContainer(p: {
  mode: "send" | "note";
  plan: NutritionPlan;
  /** Known client (Nutrition tab); null in the library, where one is picked. */
  client: { id: string; name: string } | null;
  clients?: readonly TrainerClient[];
  target?: CoachClientTarget | null;
  assignmentId?: string;
  initialNote?: string | null;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const { api } = useAdapters();
  const online = useOnlineStatus();
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(`plan-send-${localIdFactory()}`);
  const client = p.client ?? picked;
  const form = useForm<CoachNoteValues>({
    resolver: coachNoteResolver,
    mode: "onChange",
    defaultValues: { note: p.initialNote ?? "" },
  });
  const note = form.watch("note");
  const noteError = messageAt(form.formState.errors, "note") ?? null;

  async function submit(values: CoachNoteValues) {
    if (!client) return;
    setBusy(true);
    setError(null);
    const text = values.note.trim() || null;
    const result =
      p.mode === "send"
        ? await api.assignCoachMealPlan(client.id, p.plan.id, text, key.current)
        : await api.updateCoachPlanNote(client.id, p.assignmentId!, text);
    setBusy(false);
    if (result.ok) {
      const first = firstName(client.name);
      p.onDone(
        p.mode === "send" ? `Sent to ${first}` : `Note updated for ${first}`,
      );
      return;
    }
    if (result.error.status === 422) {
      form.setError("note", { type: "server", message: NOTE_MESSAGE });
      return;
    }
    setError(
      result.error.code === "network" || result.error.code === "timeout"
        ? "You’re offline. Try again when you’re back online."
        : result.error.status === 404
          ? GONE
          : SEND_FAILED,
    );
  }

  const active = (p.clients ?? []).filter((c) => c.status === "active");
  return (
    <>
      <SendPlanSheetPresenter
        visible={!picking}
        mode={p.mode}
        planName={p.plan.name}
        versusTarget={
          p.target
            ? `${kcalText(p.plan.totals.kcal)} / ${kcalText(p.target.dailyKcal)}`
            : null
        }
        clientFirst={client ? firstName(client.name) : null}
        chooseClientLabel={
          p.client ? null : (picked?.name ?? "Choose a client")
        }
        onChooseClient={p.client ? undefined : () => setPicking(true)}
        note={note}
        noteError={noteError}
        busy={busy}
        online={online}
        error={error}
        canSubmit={!!client && !noteError}
        onNote={(text) =>
          form.setValue("note", text, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
        onSubmit={() => void form.handleSubmit(submit)()}
        onClose={p.onClose}
      />
      <PickerSheetPresenter
        visible={picking}
        title="Send to"
        options={active.map((c) => ({ id: c.id, title: c.name }))}
        empty="No active clients yet."
        selectedId={picked?.id ?? null}
        onPick={(id) => {
          const c = active.find((x) => x.id === id);
          if (c) {
            // A new client is a new send: a retry must never replay the key
            // of a send to someone else.
            if (c.id !== picked?.id) {
              key.current = `plan-send-${localIdFactory()}`;
            }
            setPicked({ id: c.id, name: c.name });
          }
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
        testID="send-plan-client-picker"
      />
    </>
  );
}
