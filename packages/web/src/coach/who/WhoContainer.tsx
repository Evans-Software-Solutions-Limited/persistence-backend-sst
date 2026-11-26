import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError, newIdempotencyKey } from "../api/coachApi";
import type { ClientProfile } from "../api/types";
import {
  coachKeys,
  useClientProfile,
  useCoachApi,
  useOnline,
} from "../hooks/coachQueries";
import { applyServerErrors, applyValues, fieldMessages } from "@/lib/form";
import { CONFLICT_NOTICE, stillEditable } from "../lib/draft";
import {
  EMPTY,
  WHO_SERVER_FIELDS,
  changedFields,
  toInput,
  valuesFrom,
  whoResolver,
} from "../lib/whoForm";
import { LoadError, Loading } from "../ui/parts";
import { WhoStepView, type WhoValues } from "./WhoStep";

/** Add client · 1 Who: makes the profile, or edits it when going Back. */
export function WhoContainer() {
  const { profileId } = useParams();
  const detailQ = useClientProfile(profileId);
  if (profileId && detailQ.isPending) return <Loading />;
  if (profileId && !detailQ.data) {
    return (
      <LoadError
        message="We couldn't load this client."
        onRetry={() => detailQ.refetch()}
      />
    );
  }
  return (
    <WhoForm key={detailQ.data?.id ?? "new"} existing={detailQ.data ?? null} />
  );
}

function WhoForm({ existing: loaded }: { existing: ClientProfile | null }) {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const createKey = useRef(newIdempotencyKey());
  // The profile as the form loaded it. A background refetch (window focus)
  // must not move it: edits are compared with, and the revision sent from,
  // what the coach started from, so another device's change still gives 409.
  const [existing, setExisting] = useState(loaded);
  // react-hook-form owns the values and the rules (PER-147). Errors show
  // after Next and stay until the next press, as before.
  const form = useForm<WhoValues>({
    resolver: whoResolver,
    defaultValues: loaded ? valuesFrom(loaded) : EMPTY,
  });
  const values = form.watch();
  const errors = fieldMessages(form.formState.errors, [
    "first",
    "last",
    "contact",
    "goal",
    "notes",
  ]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function next(valid: WhoValues) {
    const input = toInput(valid);
    setError(null);
    setBusy(true);
    try {
      if (!existing) {
        const created = await api.createProfile(input, createKey.current);
        void queryClient.invalidateQueries({ queryKey: coachKeys.roster });
        void navigate(`/coach/clients/invited/${created.id}/setup`);
        return;
      }
      const patch = changedFields(existing, input);
      if (Object.keys(patch).length > 0) {
        let updated: ClientProfile;
        // When a resend happens, the server's 409 copy (newer invite code and
        // set-up) is what the saved fields land on, not the older cache.
        let fresh: ClientProfile | null = null;
        try {
          updated = await api.patchProfile(
            existing.id,
            patch,
            existing.revision,
          );
        } catch (e) {
          // The revision is per profile: a set-up save or a resent code also
          // moves it. If none of the fields the coach changed moved on the
          // server, nothing clashes: send the same change on the new revision.
          const latest =
            isCoachApiError(e) && e.code === "revision_conflict"
              ? (e.body?.current as ClientProfile | undefined)
              : undefined;
          const untouched =
            !!latest &&
            stillEditable(latest) &&
            (Object.keys(patch) as (keyof typeof patch)[]).every(
              (k) => (latest[k] ?? null) === (existing[k] ?? null),
            );
          if (!latest || !untouched) throw e;
          fresh = latest;
          updated = await api.patchProfile(existing.id, patch, latest.revision);
        }
        queryClient.setQueryData(
          coachKeys.clientProfile(existing.id),
          (old: object | undefined) =>
            fresh
              ? { ...fresh, ...updated }
              : old
                ? { ...old, ...updated }
                : old,
        );
        void queryClient.invalidateQueries({ queryKey: coachKeys.roster });
      }
      void navigate(`/coach/clients/invited/${existing.id}/setup`);
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict" && existing) {
        const latest = e.body?.current as ClientProfile | undefined;
        if (latest) {
          queryClient.setQueryData(
            coachKeys.clientProfile(existing.id),
            latest,
          );
          setExisting(latest);
          form.reset(valuesFrom(latest));
        }
        setNotice(CONFLICT_NOTICE);
      } else if (!applyServerErrors(e, form.setError, WHO_SERVER_FIELDS)) {
        setError(
          isCoachApiError(e) && e.offline
            ? "You're offline. Adding a client needs a connection."
            : isCoachApiError(e)
              ? e.message
              : "We couldn't save that. Try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <WhoStepView
      values={values}
      errors={errors}
      onChange={(next) => applyValues(form, next)}
      busy={busy}
      offline={!online}
      notice={notice}
      error={error}
      onCancel={() =>
        navigate(
          existing ? `/coach/clients/invited/${existing.id}` : "/coach/clients",
        )
      }
      onNext={() => void form.handleSubmit(next)()}
    />
  );
}
