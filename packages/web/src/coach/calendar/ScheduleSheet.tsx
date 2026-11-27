import type { UseFormReturn } from "react-hook-form";
import { firstName } from "../lib/people";
import { Dialog, Notice } from "../ui/parts";
import { KIND_LABEL, lengthLabel, reminderLabel, weekdayName } from "./lib";
import {
  LENGTH_OPTIONS,
  REMINDER_OPTIONS,
  REPEAT_OPTIONS,
  startsAtOf,
  type ScheduleValues,
} from "./scheduleForm";
import type { SessionKind, SessionScope, WorkoutOption } from "./types";
import "./calendar.css";

/**
 * C4c "Schedule with Sam" on the web (PER-144): a pure presenter over the
 * container's react-hook-form. Kind tabs, date and time, length and place,
 * linked workout, weekly repeat, and what the client gets (invite and
 * reminder).
 */

export interface PickableClient {
  id: string;
  name: string;
}

export interface ScheduleSheetProps {
  form: UseFormReturn<ScheduleValues>;
  mode: "create" | "edit";
  /** Kinds offered as tabs (Your training only from the calendar). */
  kinds: SessionKind[];
  /** Set when scheduling from Client Detail: no client picker. */
  fixedClient: PickableClient | null;
  /** The coach's active clients, for the picker (calendar only). */
  clients: PickableClient[];
  /** Read-only list of who is booked, on Edit. */
  bookedNames: string[];
  workouts: WorkoutOption[];
  /** Edit of a repeating session: this one, or this and later. */
  scope: SessionScope | null;
  onScope: (s: SessionScope) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
}

export function ScheduleSheet({
  form,
  mode,
  kinds,
  fixedClient,
  clients,
  bookedNames,
  workouts,
  scope,
  onScope,
  busy,
  error,
  onSubmit,
  onClose,
}: ScheduleSheetProps) {
  const { register, watch, setValue, formState } = form;
  const errors = formState.errors;
  const kind = watch("kind");
  const clientIds = watch("clientIds");
  const values = watch();
  const start = startsAtOf(values);
  const own = kind === "own_training";
  const title =
    mode === "edit"
      ? "Edit session"
      : fixedClient
        ? `Schedule with ${firstName(fixedClient.name)}`
        : "Schedule";
  const gets = fixedClient
    ? `${firstName(fixedClient.name)} gets`
    : bookedNames.length === 1
      ? `${firstName(bookedNames[0]!)} gets`
      : "Clients get";

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="cal-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="tabs" role="tablist" aria-label="Kind of session">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() =>
                setValue("kind", k, {
                  shouldDirty: true,
                  shouldValidate: false,
                })
              }
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {!own && !fixedClient && mode === "create" && (
          <fieldset className="cal-clients">
            <legend className="fl">Who</legend>
            {clients.length === 0 ? (
              <span className="hint">No active clients yet.</span>
            ) : (
              clients.map((c) => (
                <label key={c.id} className="cal-check">
                  <input
                    type="checkbox"
                    checked={clientIds.includes(c.id)}
                    onChange={(e) =>
                      setValue(
                        "clientIds",
                        e.target.checked
                          ? [...clientIds, c.id]
                          : clientIds.filter((id) => id !== c.id),
                        { shouldDirty: true },
                      )
                    }
                  />
                  {c.name}
                </label>
              ))
            )}
            {errors.clientIds?.message && (
              <span className="err" role="alert">
                {errors.clientIds.message}
              </span>
            )}
          </fieldset>
        )}
        {mode === "edit" && bookedNames.length > 0 && (
          <Row label="With" value={bookedNames.join(", ")} />
        )}

        <div className="cal-pair">
          <Field label="Date" error={errors.date?.message} wide>
            <input
              className="fld"
              type="date"
              aria-invalid={!!errors.date}
              {...register("date")}
            />
          </Field>
          <Field label="Time" error={errors.time?.message}>
            <input
              className="fld"
              type="time"
              step={300}
              aria-invalid={!!errors.time}
              {...register("time")}
            />
          </Field>
        </div>
        <div className="cal-pair">
          <Field label="Length" error={errors.durationMin?.message}>
            <select
              className="fld"
              aria-invalid={!!errors.durationMin}
              {...register("durationMin", { valueAsNumber: true })}
            >
              {lengthChoices(values.durationMin).map((m) => (
                <option key={m} value={m}>
                  {lengthLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          {kind === "in_person" && (
            <Field label="Where" error={errors.location?.message} wide>
              <input
                className="fld"
                placeholder="Studio A"
                aria-invalid={!!errors.location}
                {...register("location")}
              />
            </Field>
          )}
          {kind === "video" && (
            <Field label="Video link" error={errors.videoUrl?.message} wide>
              <input
                className="fld"
                type="url"
                inputMode="url"
                placeholder="https://"
                aria-invalid={!!errors.videoUrl}
                {...register("videoUrl")}
              />
            </Field>
          )}
        </div>

        <label className="cal-row">
          <span>Workout</span>
          <select
            className="fld"
            aria-label="Workout"
            aria-invalid={!!errors.workoutId}
            {...register("workoutId")}
          >
            <option value="">None</option>
            {workouts.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {errors.workoutId?.message && (
          <span className="err" role="alert">
            {errors.workoutId.message}
          </span>
        )}

        {mode === "create" ? (
          <label className="cal-row">
            <span>Repeats</span>
            <select
              className="fld"
              aria-label="Repeats"
              {...register("repeatWeeks", { valueAsNumber: true })}
            >
              {REPEAT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 1
                    ? "Doesn't repeat"
                    : `Weekly${start ? ` on ${weekdayName(start)}` : ""} · ${n} weeks`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          scope && (
            <div className="cal-row">
              <span>Change</span>
              <div className="seg" role="group" aria-label="Change">
                <button
                  type="button"
                  aria-pressed={scope === "this"}
                  onClick={() => onScope("this")}
                >
                  This session
                </button>
                <button
                  type="button"
                  aria-pressed={scope === "series"}
                  onClick={() => onScope("series")}
                >
                  This and later
                </button>
              </div>
            </div>
          )
        )}

        {!own && (
          <label className="cal-row">
            <span>{gets}</span>
            <select
              className="fld"
              aria-label={gets}
              {...register("reminderMinutes", { valueAsNumber: true })}
            >
              {REMINDER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0
                    ? "Invite only"
                    : `Invite + reminder ${reminderLabel(m)} before`}
                </option>
              ))}
            </select>
          </label>
        )}

        <Field label="Notes" error={errors.notes?.message} wide>
          <textarea
            className="fld"
            rows={2}
            aria-invalid={!!errors.notes}
            {...register("notes")}
          />
        </Field>

        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn v" type="submit" disabled={busy}>
          {busy ? "Saving…" : mode === "edit" ? "Save" : "Schedule"}
        </button>
      </form>
    </Dialog>
  );
}

/** The usual lengths, plus the session's own when it isn't one of them. */
function lengthChoices(current: number): number[] {
  return LENGTH_OPTIONS.includes(current) || !Number.isFinite(current)
    ? LENGTH_OPTIONS
    : [...LENGTH_OPTIONS, current].sort((a, b) => a - b);
}

function Field({
  label,
  error,
  wide,
  children,
}: {
  label: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "cal-field wide" : "cal-field"}>
      <span className="fl">{label}</span>
      {children}
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="cal-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
