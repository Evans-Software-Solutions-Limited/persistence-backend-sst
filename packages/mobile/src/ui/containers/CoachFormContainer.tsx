import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  FORM_TRIGGERS,
  formConflictKey,
  scheduleConflictKey,
  type FormAudience,
  type FormSchedule,
  type FormStatsClient,
  type FormTrigger,
  type RuleFields,
} from "@/domain/models/coachForms";
import {
  TRIGGER_LABELS,
  defaultRule,
  fitRuleToTrigger,
  plural,
  questionCount,
  scheduleSubtitle,
  shortDate,
} from "@/domain/services/coachForms.service";
import { resolveCoachFormsId } from "@/application/commands/coachForms.command";
import {
  useCoachFormConflicts,
  useCoachFormSchedules,
  useCoachFormStats,
  useCoachFormsActions,
  useCoachFormsLibrary,
} from "@/ui/hooks/useCoachForms";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  FormPagePresenter,
  type FormPageClient,
} from "@/ui/presenters/coachForms/FormPagePresenter";
import {
  SendFormSheetPresenter,
  type SendClient,
} from "@/ui/presenters/coachForms/SendFormSheetPresenter";

/** "Reminder sent 18:00" / "Not done" (BRIEF: "Opened, not sent" isn't tracked). */
export function outstandingRow(
  c: FormStatsClient,
  now: Date = new Date(),
): FormPageClient {
  const time = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  };
  const name = c.name?.trim() || "Client";
  if (c.status === "done") {
    return {
      key: c.requestId,
      name,
      detail: c.completedAt
        ? `Done ${shortDate(c.completedAt, now)}${c.late ? " · late" : ""}`
        : "Done",
      pill: { tone: "done", text: "Done" },
    };
  }
  return {
    key: c.requestId,
    name,
    detail: c.lastReminderAt
      ? `Reminder sent ${time(c.lastReminderAt)}`
      : "Not done",
    pill:
      c.status === "missed"
        ? { tone: "waiting", text: "Missed" }
        : { tone: "waiting", text: "Not done" },
  };
}

type SheetState = {
  scheduleId: string | null;
  audience: FormAudience;
  selectedIds: string[];
  trigger: FormTrigger;
  rule: RuleFields;
};

/** The send sheet's starting state: a live rule to change, or a new send. */
export function initialSheet(
  schedule: FormSchedule | null,
  opts: { sendTo?: string; trigger?: FormTrigger } = {},
): SheetState {
  if (schedule) {
    return {
      scheduleId: schedule.id,
      audience: schedule.audience,
      selectedIds: schedule.clients
        .filter((c) => c.status !== "excluded")
        .map((c) => c.clientId),
      trigger: schedule.trigger,
      rule: fitRuleToTrigger(schedule.trigger, schedule),
    };
  }
  const trigger = opts.trigger ?? "weekly";
  return {
    scheduleId: null,
    audience: "selected",
    selectedIds: opts.sendTo ? [opts.sendTo] : [],
    trigger,
    rule: defaultRule(trigger),
  };
}

/** Whether the sheet can save: someone to send to and a complete rule. */
export function canSendSheet(sheet: SheetState): boolean {
  if (sheet.audience === "selected" && sheet.selectedIds.length === 0) {
    return false;
  }
  if (sheet.trigger === "weekly") {
    return !!sheet.rule.weekday && !!sheet.rule.timeLocal;
  }
  if (sheet.trigger === "daily") return !!sheet.rule.timeLocal;
  return true;
}

function isTrigger(v: unknown): v is FormTrigger {
  return (
    typeof v === "string" && (FORM_TRIGGERS as readonly string[]).includes(v)
  );
}

/**
 * The form page and the C10h send sheet. Route params: `id`, plus
 * `send=1` (open the sheet), `scheduleId` (change that rule), `sendTo`
 * (preselect a client, from C3.3b "+ Add"), `trigger` (from a C10g
 * section's "+ Add").
 */
export function CoachFormContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    send?: string;
    scheduleId?: string;
    sendTo?: string;
    trigger?: string;
  }>();
  const id = resolveCoachFormsId(params.id ?? "");
  const library = useCoachFormsLibrary();
  const schedules = useCoachFormSchedules();
  const stats = useCoachFormStats();
  const {
    conflicts,
    dismiss,
    reload: reloadConflicts,
  } = useCoachFormConflicts();
  const actions = useCoachFormsActions({
    onLocalWrite: () => {
      library.reload();
      schedules.reload();
    },
  });
  const online = useOnlineStatus();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const clients = useGetTrainerClients(sheet !== null);

  const form = library.data?.forms.find((f) => f.id === id) ?? null;
  const rules = useMemo(
    () =>
      (schedules.data ?? []).filter(
        (s) => s.formId === id && s.status !== "stopped",
      ),
    [schedules.data, id],
  );
  const formStats = stats.data?.forms.find((s) => s.formId === id) ?? null;

  // Deep-link opens (send=1, scheduleId=…) once the data is there.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (opened || !form) return;
    const sid = params.scheduleId
      ? resolveCoachFormsId(params.scheduleId)
      : null;
    const schedule = sid ? (rules.find((r) => r.id === sid) ?? null) : null;
    if (params.send === "1" || schedule) {
      setSheet(
        initialSheet(schedule, {
          sendTo: params.sendTo,
          trigger: isTrigger(params.trigger) ? params.trigger : undefined,
        }),
      );
    }
    setOpened(true);
  }, [opened, form, rules, params]);

  const activeClients: SendClient[] = useMemo(
    () =>
      (clients.data ?? [])
        .filter((c) => c.status === "active")
        .map((c) => ({ id: c.id, name: c.name, initials: c.initials })),
    [clients.data],
  );

  const conflictKeys = new Set(conflicts.map((c) => c.key));
  const formConflict = conflictKeys.has(formConflictKey(id));
  const ruleConflict = rules.find((r) =>
    conflictKeys.has(scheduleConflictKey(r.id)),
  );

  const refreshAll = useCallback(() => {
    void library.refresh();
    void schedules.refresh();
    void stats.refresh();
  }, [library, schedules, stats]);

  const reloadAll = useCallback(() => {
    library.reload();
    schedules.reload();
    stats.reload();
    reloadConflicts();
  }, [library, schedules, stats, reloadConflicts]);

  const onSend = useCallback(async () => {
    if (!sheet || !form) return;
    const current = sheet;
    setSheet(null);
    await actions.saveSchedule({
      ...current.rule,
      ...(current.scheduleId ? { scheduleId: current.scheduleId } : {}),
      formId: form.id,
      trigger: current.trigger,
      audience: current.audience,
      clientIds: current.selectedIds,
    });
    reloadAll();
  }, [sheet, form, actions, reloadAll]);

  const sendCount =
    sheet?.audience === "selected"
      ? sheet.selectedIds.length
      : activeClients.length;

  return (
    <>
      <FormPagePresenter
        found={form !== null || library.data === null}
        title={form?.title ?? ""}
        subtitle={form ? plural(questionCount(form), "question") : ""}
        rules={rules.map((r) => ({
          id: r.id,
          title: TRIGGER_LABELS[r.trigger],
          subtitle: form
            ? scheduleSubtitle(form, r, formStats?.reached ?? null)
            : "",
        }))}
        outstanding={(formStats?.clients ?? []).map((c) => outstandingRow(c))}
        offline={!online}
        conflict={formConflict || ruleConflict !== undefined}
        onDismissConflict={() => {
          dismiss(formConflictKey(id));
          if (ruleConflict) dismiss(scheduleConflictKey(ruleConflict.id));
        }}
        isRefreshing={library.isRefreshing}
        onRefresh={refreshAll}
        onBack={() => router.back()}
        onSend={() => setSheet(initialSheet(null))}
        onEdit={() =>
          router.push({
            pathname: "/(app)/coach-forms/edit",
            params: { id },
          } as never)
        }
        onOpenRule={(scheduleId) => {
          const schedule = rules.find((r) => r.id === scheduleId) ?? null;
          setSheet(initialSheet(schedule));
        }}
      />
      {sheet && form ? (
        <SendFormSheetPresenter
          visible
          onClose={() => setSheet(null)}
          formTitle={form.title}
          editing={sheet.scheduleId !== null}
          audience={sheet.audience}
          onAudience={(audience) => setSheet({ ...sheet, audience })}
          clients={activeClients}
          selectedIds={sheet.selectedIds}
          onToggleClient={(cid) =>
            setSheet({
              ...sheet,
              selectedIds: sheet.selectedIds.includes(cid)
                ? sheet.selectedIds.filter((x) => x !== cid)
                : [...sheet.selectedIds, cid],
            })
          }
          trigger={sheet.trigger}
          onTrigger={(trigger) =>
            setSheet({
              ...sheet,
              trigger,
              rule:
                trigger === sheet.trigger ? sheet.rule : defaultRule(trigger),
            })
          }
          rule={sheet.rule}
          onRule={(rule) => setSheet({ ...sheet, rule })}
          sendCount={sendCount}
          canSend={canSendSheet(sheet)}
          onSend={() => void onSend()}
          offline={!online}
          conflict={
            sheet.scheduleId !== null &&
            conflictKeys.has(scheduleConflictKey(sheet.scheduleId))
          }
          onDismissConflict={() =>
            sheet.scheduleId && dismiss(scheduleConflictKey(sheet.scheduleId))
          }
        />
      ) : null}
    </>
  );
}
