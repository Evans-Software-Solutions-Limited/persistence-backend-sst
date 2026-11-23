import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import type { ClientProfile } from "../api/types";
import {
  coachKeys,
  useClientProfile,
  useCoachApi,
  useLibrary,
  useOnline,
} from "../hooks/coachQueries";
import { useInviteActions } from "../invite/useInviteActions";
import { CONFLICT_NOTICE, stillEditable } from "../lib/draft";
import { clockTime, firstName, initials } from "../lib/people";
import {
  WEB_SECTIONS,
  buildLibrary,
  inviteState,
  itemsOf,
  overviewSummary,
  overviewTitle,
} from "../lib/setup";
import { LoadError, Loading } from "../ui/parts";
import { InvitedClientView } from "./InvitedClient";

/** The invited client's page (C11d). */
export function InvitedClientContainer() {
  const { profileId = "" } = useParams();
  const navigate = useNavigate();
  const api = useCoachApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const detailQ = useClientProfile(profileId);
  const library = useLibrary();
  const actions = useInviteActions((id) =>
    navigate(`/coach/clients/invited/${id}/invite`),
  );
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  // What the notes were, and the revision, when Edit was pressed: a refetch
  // while editing must not move them (another device's edit → 409).
  const [notesBase, setNotesBase] = useState<{
    notes: string | null;
    revision: number;
  } | null>(null);
  const [notesBusy, setNotesBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const lib = useMemo(
    () => buildLibrary(library.forms, library.schedules, library.plans),
    [library.forms, library.schedules, library.plans],
  );

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const detail = detailQ.data;
  if (detailQ.isPending) return <Loading />;
  if (!detail) {
    return (
      <LoadError
        message={
          isCoachApiError(detailQ.error) && detailQ.error.status === 404
            ? "This client isn't in your list."
            : online
              ? "We couldn't load this client."
              : "You're offline. This client loads when you're back online."
        }
        onRetry={() => detailQ.refetch()}
      />
    );
  }
  if (detail.status === "active" && detail.clientId) {
    return <Navigate to={`/coach/clients/${detail.clientId}`} replace />;
  }

  const key = coachKeys.clientProfile(detail.id);
  const clientFirst = firstName(detail.displayName);
  const state = inviteState(detail.invite);

  async function saveNotes() {
    if (notesDraft === null) return;
    const next = notesDraft.trim() ? notesDraft.trim() : null;
    const base = notesBase ?? {
      notes: detail!.privateNotes,
      revision: detail!.revision,
    };
    if (next === (base.notes ?? null)) {
      setNotesDraft(null);
      return;
    }
    setNotesBusy(true);
    setError(null);
    try {
      const save = (revision: number) =>
        api.patchProfile(detail!.id, { privateNotes: next }, revision);
      let updated: ClientProfile;
      try {
        updated = await save(base.revision);
      } catch (e) {
        // A 409 from a change elsewhere on the profile (set-up, resend):
        // if the notes themselves are as Edit found them, save once more.
        const latest =
          isCoachApiError(e) && e.code === "revision_conflict"
            ? (e.body?.current as ClientProfile | undefined)
            : undefined;
        if (
          !latest ||
          !stillEditable(latest) ||
          (latest.privateNotes ?? null) !== (base.notes ?? null)
        ) {
          throw e;
        }
        updated = await save(latest.revision);
      }
      queryClient.setQueryData(key, { ...detail!, ...updated });
      setNotesDraft(null);
      setToast("Saved");
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        const latest = e.body?.current as ClientProfile | undefined;
        if (latest) queryClient.setQueryData(key, latest);
        setNotesDraft(null);
        setNotice(CONFLICT_NOTICE);
      } else {
        setError(
          isCoachApiError(e) && e.offline
            ? "You're offline. Your note saves when you're back online."
            : isCoachApiError(e)
              ? e.message
              : "We couldn't save the note.",
        );
      }
    } finally {
      setNotesBusy(false);
    }
  }

  return (
    <>
      <InvitedClientView
        name={detail.displayName}
        clientFirst={clientFirst}
        initials={initials(detail.displayName)}
        goal={detail.goal}
        state={state}
        rows={WEB_SECTIONS.map((s) => {
          const items = itemsOf(detail, s);
          return {
            section: s,
            title: overviewTitle(s, items, lib),
            summary: overviewSummary(s, items, lib),
            empty: items.length === 0,
          };
        })}
        notes={detail.privateNotes}
        notesDraft={notesDraft}
        notesBusy={notesBusy}
        copied={copied}
        resendBusy={actions.busyId === detail.id}
        cancelling={actions.busyId === detail.id}
        confirmCancel={confirmCancel}
        offlineAsOf={online ? null : clockTime(detailQ.dataUpdatedAt)}
        notice={notice}
        error={actions.error ?? error}
        toast={toast}
        onOpen={(s) =>
          navigate(
            `/coach/clients/invited/${detail.id}/setup/${s}?from=invited`,
          )
        }
        onEditNotes={() => {
          setNotesBase({
            notes: detail.privateNotes,
            revision: detail.revision,
          });
          setNotesDraft(detail.privateNotes ?? "");
        }}
        onNotesChange={setNotesDraft}
        onSaveNotes={() => void saveNotes()}
        onCancelNotes={() => setNotesDraft(null)}
        onCopyLink={async () => {
          if (!detail.invite || state !== "active") return;
          try {
            await navigator.clipboard.writeText(detail.invite.link);
            setCopied(true);
          } catch {
            setError(
              "Your browser didn't allow copying. Open the invite to see the code.",
            );
          }
        }}
        onResend={() => void actions.issue(detail.id)}
        onAskCancel={() => setConfirmCancel(true)}
        onKeepInvite={() => setConfirmCancel(false)}
        onConfirmCancel={async () => {
          if (await actions.cancel(detail.id)) {
            setConfirmCancel(false);
            navigate("/coach/clients");
          }
        }}
      />
      {actions.dialog}
    </>
  );
}
