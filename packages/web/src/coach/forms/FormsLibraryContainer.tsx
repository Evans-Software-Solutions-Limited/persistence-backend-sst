import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCoachApiError, newIdempotencyKey } from "../api/coachApi";
import type { FormSchedule, RosterClient } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
  useRoster,
} from "../hooks/coachQueries";
import {
  EDITED_ELSEWHERE,
  defaultRule,
  groupLibrary,
  ruleBody,
  ruleOf,
} from "../lib/forms";
import { clockTime } from "../lib/people";
import type { EffectiveRule } from "../lib/schedule";
import { LoadError, Loading } from "../ui/parts";
import { FormPreview, FormsLibrary, SendDialog } from "./FormsLibrary";

/** What the send dialog is doing: a new rule, or changing an existing one. */
type Sending =
  | { kind: "new"; formId: string }
  | { kind: "change"; formId: string; schedule: FormSchedule };

function errorText(e: unknown, offline: string, fallback: string): string {
  if (isCoachApiError(e) && e.offline) return offline;
  if (isCoachApiError(e)) return e.message;
  return fallback;
}

/**
 * Library → Forms (C10a) with the send dialog (C10c). Routes:
 * `/coach/library/forms`, `…/:formId`, `…/:formId/send?when=weekly`.
 */
export function FormsLibraryContainer() {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { formId: routeFormId, action } = useParams();
  const [search] = useSearchParams();
  const roster = useRoster();

  const forms = useQuery({
    queryKey: coachKeys.forms,
    queryFn: () => api.forms(),
    networkMode: COACH_NETWORK_MODE,
  });
  const schedules = useQuery({
    queryKey: coachKeys.schedules,
    queryFn: () => api.formSchedules(),
    networkMode: COACH_NETWORK_MODE,
  });
  const stats = useQuery({
    queryKey: coachKeys.formStats,
    queryFn: () => api.formStats(),
    networkMode: COACH_NETWORK_MODE,
  });
  const [showTemplates, setShowTemplates] = useState(false);
  const templates = useQuery({
    queryKey: coachKeys.templates,
    queryFn: () => api.templates(),
    enabled: showTemplates,
    networkMode: COACH_NETWORK_MODE,
  });

  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Send dialog state.
  const [draftRule, setDraftRule] = useState<EffectiveRule | null>(null);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const groups = useMemo(
    () => groupLibrary(forms.data ?? [], schedules.data),
    [forms.data, schedules.data],
  );
  const rows = useMemo(
    () => [
      ...groups.on_join,
      ...groups.repeating,
      ...groups.once,
      ...groups.on_end,
      ...groups.none,
    ],
    [groups],
  );
  const statsById = useMemo(
    () => new Map((stats.data?.forms ?? []).map((f) => [f.formId, f])),
    [stats.data],
  );
  const active: RosterClient[] = useMemo(
    () => (roster.data?.data ?? []).filter((c) => c.status === "active"),
    [roster.data],
  );

  const selected =
    rows.find((r) => r.form.id === routeFormId) ??
    (routeFormId ? null : (groups.repeating[0] ?? rows[0] ?? null));

  // Open the dialog when the route asks for it (once per route visit).
  const sending: Sending | null = (() => {
    if (!routeFormId || (action !== "send" && action !== "change")) return null;
    const row = rows.find((r) => r.form.id === routeFormId);
    if (!row) return null;
    if (action === "change" && row.schedules[0]) {
      return {
        kind: "change",
        formId: routeFormId,
        schedule: row.schedules[0],
      };
    }
    return { kind: "new", formId: routeFormId };
  })();
  const sendKey = sending
    ? `${sending.kind}:${sending.formId}:${search.get("when") ?? ""}`
    : null;
  if (sending && sendKey !== opened) {
    setOpened(sendKey);
    setSendError(null);
    if (sending.kind === "change") {
      const s = sending.schedule;
      setDraftRule(ruleOf(s));
      setAll(s.audience === "all_clients");
      setPicked(
        (s.clients ?? [])
          .filter((c) => c.status === "active")
          .map((c) => c.clientId),
      );
    } else {
      setDraftRule(defaultRule(search.get("when") ?? "weekly"));
      setAll(false);
      // "+ Add form" on a client's Check-ins tab sends to that client.
      const forClient = search.get("client");
      setPicked(forClient ? [forClient] : []);
    }
  }
  if (!sending && opened !== null) setOpened(null);

  if (forms.isPending || schedules.isPending) return <Loading />;
  if (!forms.data || !schedules.data) {
    return (
      <LoadError
        message={
          online
            ? "We couldn't load your forms."
            : "You're offline. Your forms load when you're back online."
        }
        onRetry={() => {
          void forms.refetch();
          void schedules.refetch();
        }}
      />
    );
  }

  const go = (path: string) => navigate(`/coach/library/forms${path}`);
  const backTo = search.get("client");
  const close = () =>
    backTo
      ? navigate(`/coach/clients/${backTo}/check-ins`)
      : go(routeFormId ? `/${routeFormId}` : "");

  async function submit() {
    if (!sending || !draftRule) return;
    setBusy(true);
    setSendError(null);
    setNotice(null);
    const audience: "all_clients" | "selected" =
      all || draftRule.trigger === "on_join" ? "all_clients" : "selected";
    const body = {
      audience,
      ...(audience === "selected" ? { clientIds: picked } : {}),
      ...ruleBody(draftRule),
    };
    try {
      if (sending.kind === "new") {
        await api.createSchedule(
          { formId: sending.formId, trigger: draftRule.trigger, ...body },
          newIdempotencyKey(),
        );
      } else {
        await api.patchSchedule(
          sending.schedule.id,
          body,
          sending.schedule.revision,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: coachKeys.schedules }),
        queryClient.invalidateQueries({ queryKey: coachKeys.formStats }),
        ...(backTo
          ? [
              queryClient.invalidateQueries({
                queryKey: coachKeys.clientForms(backTo),
              }),
            ]
          : []),
      ]);
      close();
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        const current = e.body?.current as FormSchedule | undefined;
        if (current) {
          queryClient.setQueryData<FormSchedule[]>(coachKeys.schedules, (old) =>
            (old ?? []).map((s) => (s.id === current.id ? current : s)),
          );
        }
        void queryClient.invalidateQueries({ queryKey: coachKeys.schedules });
        setNotice(EDITED_ELSEWHERE);
        close();
      } else {
        setSendError(
          errorText(
            e,
            "You're offline. Sending needs a connection.",
            "We couldn't send that form. Try again.",
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const sendingForm = sending
    ? forms.data.find((f) => f.id === sending.formId)
    : undefined;
  const previewForm = preview
    ? forms.data.find((f) => f.id === preview)
    : undefined;

  return (
    <>
      <FormsLibrary
        groups={groups}
        stats={statsById}
        totals={stats.data?.totals ?? null}
        selected={selected}
        templates={templates.data ?? (templates.isError ? [] : null)}
        showTemplates={showTemplates}
        showAllOutstanding={showAll}
        offlineAsOf={online ? null : clockTime(forms.dataUpdatedAt)}
        notice={notice}
        error={error}
        onSelect={(id) => {
          setShowAll(false);
          go(`/${id}`);
        }}
        onNew={(when) =>
          navigate(`/coach/library/forms/new${when ? `?when=${when}` : ""}`)
        }
        onEdit={(id) => go(`/${id}/edit`)}
        onSend={(id) => go(`/${id}/send`)}
        onChange={(id) => go(`/${id}/change`)}
        onPreview={setPreview}
        onToggleTemplates={() => setShowTemplates((v) => !v)}
        onUseTemplate={async (key) => {
          setError(null);
          try {
            const created = await api.createFromTemplate(
              key,
              newIdempotencyKey(),
            );
            await queryClient.invalidateQueries({ queryKey: coachKeys.forms });
            go(`/${created.id}/edit`);
          } catch (e) {
            setError(
              errorText(
                e,
                "You're offline. Using a template needs a connection.",
                "We couldn't copy that template.",
              ),
            );
          }
        }}
        onToggleOutstanding={() => setShowAll((v) => !v)}
      />
      {sending && sendingForm && draftRule && (
        <SendDialog
          form={sendingForm}
          editing={sending.kind === "change"}
          rule={draftRule}
          all={all}
          selected={active.filter((c) => picked.includes(c.id))}
          candidates={active.filter((c) => !picked.includes(c.id))}
          busy={busy}
          error={sendError}
          onRule={setDraftRule}
          onAll={setAll}
          onAdd={(id) => setPicked((p) => [...p, id])}
          onRemove={(id) => setPicked((p) => p.filter((x) => x !== id))}
          onCancel={close}
          onSubmit={() => void submit()}
        />
      )}
      {previewForm && (
        <FormPreview form={previewForm} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
