import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import type {
  ClientFormEntry,
  ClientSetupInput,
  FormResponse,
  RosterClient,
} from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
} from "../hooks/coachQueries";
import {
  clientOverride,
  clientRule,
  defaultRule,
  pausedForClient,
} from "../lib/forms";
import { clockTime, firstName } from "../lib/people";
import type { EffectiveRule } from "../lib/schedule";
import { LoadError, Loading } from "../ui/parts";
import { AddFormDialog, CheckinsTab } from "./CheckinsTab";
import { ClientFormPanel } from "./ClientFormPanel";

function failure(e: unknown, offline: string, fallback: string): string {
  if (isCoachApiError(e) && e.offline) return offline;
  if (isCoachApiError(e)) return e.message;
  return fallback;
}

/** The first weekly rule's form, else the first form (C3.3 default). */
function defaultForm(entries: ClientFormEntry[]): string | null {
  return (
    entries.find((e) => e.rules.some((r) => r.trigger === "weekly"))?.form.id ??
    entries[0]?.form.id ??
    null
  );
}

/**
 * Client → Check-ins (C3.3a) and the one-client set-up panel (C10j). Reads
 * the client's forms and response history; review and reply are idempotent
 * writes; set-up has no revision (last write wins).
 */
export function CheckinsContainer({ client }: { client: RosterClient }) {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const clientFirst = firstName(client.name);

  const entriesQ = useQuery({
    queryKey: coachKeys.clientForms(client.id),
    queryFn: () => api.clientForms(client.id),
    networkMode: COACH_NETWORK_MODE,
  });
  const responsesQ = useQuery({
    queryKey: coachKeys.responses(client.id),
    queryFn: () => api.responses(client.id),
    networkMode: COACH_NETWORK_MODE,
  });
  const libraryQ = useQuery({
    queryKey: coachKeys.forms,
    queryFn: () => api.forms(),
    networkMode: COACH_NETWORK_MODE,
  });

  const [formId, setFormId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [panelFor, setPanelFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<EffectiveRule | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [adding, setAdding] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const history = useMemo(() => responsesQ.data?.data ?? [], [responsesQ.data]);
  const selectedFormId = formId ?? defaultForm(entries);
  const forForm = history.filter((r) => r.formId === selectedFormId);
  const shown = history.find((r) => r.id === shownId) ?? forForm[0] ?? null;
  const sameForm = shown
    ? history.filter((r) => r.formId === shown.formId)
    : [];
  const earlier = shown
    ? sameForm.filter((r) => r.submittedAt < shown.submittedAt)
    : [];
  const compareWith =
    earlier.find((r) => r.id === compareId) ?? earlier[0] ?? null;

  if (entriesQ.isPending || responsesQ.isPending) return <Loading />;
  if (!entriesQ.data || !responsesQ.data) {
    return (
      <LoadError
        message={
          online
            ? `We couldn't load ${clientFirst}'s check-ins.`
            : `You're offline. ${clientFirst}'s check-ins load when you're back online.`
        }
        onRetry={() => {
          void entriesQ.refetch();
          void responsesQ.refetch();
        }}
      />
    );
  }

  const panelEntry = entries.find((e) => e.form.id === panelFor) ?? null;

  function putResponse(updated: FormResponse) {
    queryClient.setQueryData<{
      data: FormResponse[];
      nextCursor: string | null;
    }>(
      coachKeys.responses(client.id),
      (old) =>
        old && {
          ...old,
          data: old.data.map((r) => (r.id === updated.id ? updated : r)),
        },
    );
  }

  async function review(replyText?: string) {
    if (!shown) return;
    setBusy(true);
    setError(null);
    try {
      putResponse(await api.reviewResponse(client.id, shown.id, replyText));
      setReplyOpen(false);
      setReply("");
    } catch (e) {
      setError(
        failure(
          e,
          "You're offline. Reviewing needs a connection; your reply is still here.",
          "We couldn't save that. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  /** One or more set-up writes, in order; the last answer is kept. */
  async function setup(
    inputs: ClientSetupInput | ClientSetupInput[],
    done: string,
  ) {
    if (!panelEntry) return;
    setBusy(true);
    setPanelError(null);
    try {
      let updated: ClientFormEntry | null = null;
      for (const input of Array.isArray(inputs) ? inputs : [inputs]) {
        updated = await api.clientFormSetup(
          client.id,
          panelEntry.form.id,
          input,
        );
      }
      queryClient.setQueryData<ClientFormEntry[]>(
        coachKeys.clientForms(client.id),
        (old) =>
          updated
            ? (old ?? []).map((e) =>
                e.form.id === updated.form.id ? updated : e,
              )
            : (old ?? []).filter((e) => e.form.id !== panelEntry.form.id),
      );
      void queryClient.invalidateQueries({ queryKey: coachKeys.formStats });
      setPanelFor(null);
      setConfirmStop(false);
      setNotice(done);
    } catch (e) {
      setConfirmStop(false);
      setPanelError(
        failure(
          e,
          "You're offline. Changes for one client need a connection.",
          "We couldn't save that. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const sentIds = new Set(entries.map((e) => e.form.id));
  const addable = (libraryQ.data ?? []).filter(
    (f) => !f.archivedAt && !sentIds.has(f.id),
  );
  const reachingRules = (e: ClientFormEntry) =>
    e.rules.length > 0 ? e.rules : e.rule ? [e.rule] : [];
  const status = (e: ClientFormEntry) =>
    pausedForClient(e) ? ("paused" as const) : ("active" as const);

  return (
    <>
      <CheckinsTab
        clientFirst={clientFirst}
        entries={entries}
        history={history}
        selectedFormId={selectedFormId}
        shown={shown}
        compareWith={compareWith}
        earlier={earlier}
        replyOpen={replyOpen}
        reply={reply}
        busy={busy}
        offlineAsOf={online ? null : clockTime(entriesQ.dataUpdatedAt)}
        notice={notice}
        error={error}
        onOpenForm={(id) => {
          setFormId(id);
          setShownId(null);
          setCompareId(null);
          const entry = entries.find((e) => e.form.id === id);
          setPanelFor(id);
          setDraft(entry?.rule ? clientRule(entry.rule) : null);
          setConfirmStop(false);
          setPanelError(null);
          setNotice(null);
        }}
        onShow={(id) => {
          const r = history.find((x) => x.id === id);
          if (r) setFormId(r.formId);
          setShownId(id);
          setCompareId(null);
          setReplyOpen(false);
        }}
        onCompare={setCompareId}
        onAddForm={() => setAdding(true)}
        onReplyOpen={(open) => {
          setReplyOpen(open);
          setReply(open ? (shown?.replyText ?? "") : "");
        }}
        onReply={setReply}
        onSendReply={() => void review(reply.trim())}
        onMarkReviewed={() => void review()}
      />
      {panelEntry && (
        <ClientFormPanel
          clientFirst={clientFirst}
          entry={panelEntry}
          rule={draft ?? defaultRule("once")}
          confirmStop={confirmStop}
          busy={busy}
          error={panelError}
          onRule={setDraft}
          onClose={() => setPanelFor(null)}
          onSave={() =>
            void setup(
              {
                status: status(panelEntry),
                // One rule at a time: without scheduleId the server applies
                // the override to every live rule of the form (Inspector
                // Brad, #555).
                scheduleId: panelEntry.rule!.scheduleId,
                override: clientOverride(panelEntry.rule!, draft!),
              },
              `${panelEntry.form.title} is set up for ${clientFirst}.`,
            )
          }
          onPause={() =>
            void setup(
              // Each rule that reaches this client, keeping its own
              // override: the form shows Paused and can be resumed, and no
              // rule they aren't on gains a target (Inspector Brad, #555).
              reachingRules(panelEntry).map((r) => ({
                status: "paused" as const,
                scheduleId: r.scheduleId,
              })),
              `${panelEntry.form.title} is paused for ${clientFirst}.`,
            )
          }
          onResume={() =>
            void setup(
              // Each rule that reaches this client, keeping its own
              // override: the form shows Paused and can be resumed, and no
              // rule they aren't on gains a target (Inspector Brad, #555).
              reachingRules(panelEntry).map((r) => ({
                status: "active" as const,
                scheduleId: r.scheduleId,
              })),
              `${panelEntry.form.title} is back on for ${clientFirst}.`,
            )
          }
          onAskStop={() => setConfirmStop(true)}
          onKeep={() => setConfirmStop(false)}
          onStop={() =>
            void setup(
              { status: "excluded" },
              `${panelEntry.form.title} is stopped for ${clientFirst}.`,
            )
          }
        />
      )}
      {adding && (
        <AddFormDialog
          clientFirst={clientFirst}
          forms={addable}
          onClose={() => setAdding(false)}
          onPick={(id) =>
            navigate(`/coach/library/forms/${id}/send?client=${client.id}`)
          }
        />
      )}
    </>
  );
}
