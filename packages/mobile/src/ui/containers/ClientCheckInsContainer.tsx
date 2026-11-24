import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";

import type {
  ClientForm,
  ClientFormRule,
  ClientSetupInput,
  ClientTrigger,
  FormTrigger,
  RuleFields,
} from "@/domain/models/coachForms";
import {
  defaultRule,
  effectiveRule,
  fitRuleToTrigger,
  historyRows,
  plural,
  previousResponse,
  questionCount,
  responseSummary,
  sentToRows,
  shortDate,
} from "@/domain/services/coachForms.service";
import {
  useCoachClientForms,
  useCoachFormResponses,
  useCoachFormsActions,
  useCoachFormsLibrary,
} from "@/ui/hooks/useCoachForms";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  CheckInsTabPresenter,
  type LatestCard,
} from "@/ui/presenters/coachForms/CheckInsTabPresenter";
import {
  ClientSetupSheetPresenter,
  FormPickerSheetPresenter,
} from "@/ui/presenters/coachForms/ClientSetupSheetPresenter";

const CLIENT_TRIGGERS: readonly string[] = ["once", "weekly", "daily"];

type SetupState = {
  form: ClientForm;
  /** The rule's own cadence (what an override changes from). */
  baseTrigger: FormTrigger;
  trigger: FormTrigger;
  rule: RuleFields;
};

/** C10j's starting state: this client's effective rule. */
export function initialSetup(form: ClientForm): SetupState {
  const base = form.rule;
  if (!base) {
    return {
      form,
      baseTrigger: "once",
      trigger: "once",
      rule: defaultRule("once"),
    };
  }
  const eff = effectiveRule(base);
  return {
    form,
    baseTrigger: base.trigger,
    trigger: eff.trigger,
    rule: fitRuleToTrigger(eff.trigger, eff),
  };
}

/** The rules that reach this client (the one `rule` when `rules` is empty). */
function clientRules(form: ClientForm): ClientFormRule[] {
  const rules =
    form.rules.length > 0 ? form.rules : form.rule ? [form.rule] : [];
  return rules.filter((r) => r.clientStatus !== "excluded");
}

/**
 * Paused for THIS client: their own target on every rule that reaches them.
 * A rule paused for everyone (or the form's `state`) isn't a pause for
 * them, so Save and Resume don't write one. Mirrors web `pausedForClient`
 * (Inspector Brad #556 sweep 2).
 */
export function setupPaused(form: ClientForm): boolean {
  const rules = clientRules(form);
  return rules.length > 0 && rules.every((r) => r.clientStatus === "paused");
}

/**
 * The PUT bodies for Pause / Resume: one per rule that reaches this client,
 * each naming its rule and leaving `override` out so each keeps its own. A
 * PUT without `scheduleId` would add a target on every live rule of the
 * form, rules this client was never on included (Inspector Brad #556 sweep
 * 2). A rule-less form takes one write for the form.
 */
export function setupPauseInputs(form: ClientForm): ClientSetupInput[] {
  const status = setupPaused(form) ? "active" : "paused";
  const rules = clientRules(form);
  return rules.length > 0
    ? rules.map((r) => ({ status, scheduleId: r.scheduleId }))
    : [{ status }];
}

/**
 * The PUT body for Save: the edited rule only (`scheduleId` + override), so
 * its status is that rule's own target for this client, not the all-rules
 * check behind Pause / Resume (Inspector Brad #555 sweep 4).
 */
export function setupSaveInput(s: SetupState): ClientSetupInput {
  const rule = fitRuleToTrigger(s.trigger, s.rule);
  return {
    status: s.form.rule?.clientStatus === "paused" ? "paused" : "active",
    override: {
      ...(CLIENT_TRIGGERS.includes(s.baseTrigger)
        ? {
            trigger:
              s.trigger === s.baseTrigger ? null : (s.trigger as ClientTrigger),
          }
        : {}),
      weekday: rule.weekday,
      timeLocal: rule.timeLocal,
      dueAfterHours: rule.dueAfterHours,
      reminders: rule.reminders,
    },
    ...(s.form.rule ? { scheduleId: s.form.rule.scheduleId } : {}),
  };
}

/**
 * C3.3b Check-ins tab on the client page, with the C10j per-client sheet
 * (tap a "Sent to" form) and the "+ Add" form picker. Everything reads the
 * SQLite cache first, so the tab works offline; changes queue.
 */
export function ClientCheckInsContainer(p: {
  clientId: string;
  clientName: string | null;
  /** Bumped by the page's pull-to-refresh. */
  refreshKey?: number;
}) {
  const router = useRouter();
  const forms = useCoachClientForms(p.clientId);
  const responses = useCoachFormResponses(p.clientId);
  const actions = useCoachFormsActions({
    onLocalWrite: () => {
      forms.reload();
      responses.reload();
    },
  });
  const online = useOnlineStatus();
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [picking, setPicking] = useState(false);
  const library = useCoachFormsLibrary({ enabled: picking });
  const firstName = p.clientName?.trim().split(/\s+/)[0] || "this client";

  const refreshForms = forms.refresh;
  const refreshResponses = responses.refresh;
  const lastKey = useRef(p.refreshKey);
  useEffect(() => {
    if (lastKey.current === p.refreshKey) return;
    lastKey.current = p.refreshKey;
    void refreshForms();
    void refreshResponses();
  }, [p.refreshKey, refreshForms, refreshResponses]);

  const list = useMemo(() => responses.data ?? [], [responses.data]);
  const latest: LatestCard | null = useMemo(() => {
    const r = list[0];
    if (!r) return null;
    return {
      responseId: r.id,
      eyebrow: `${r.reviewedAt === null ? "New" : "Latest"} · ${shortDate(r.submittedAt)}`,
      title: r.title,
      summary: responseSummary(r, previousResponse(list, r)),
    };
  }, [list]);

  const reloadAll = useCallback(() => {
    forms.reload();
    responses.reload();
  }, [forms, responses]);

  const runSetup = useCallback(
    async (formId: string, inputs: ClientSetupInput[]) => {
      setSetup(null);
      for (const input of inputs) {
        await actions.setClientSetup(p.clientId, formId, input);
      }
      reloadAll();
    },
    [actions, p.clientId, reloadAll],
  );

  const status = setup
    ? setup.form.state === "paused" || setupPaused(setup.form)
      ? "Paused"
      : setup.form.state === "done" && setup.form.lastDoneAt
        ? `Last done ${shortDate(setup.form.lastDoneAt)}`
        : "Not done yet"
    : "";

  return (
    <>
      <CheckInsTabPresenter
        firstName={firstName}
        isLoading={
          forms.data === null &&
          responses.data === null &&
          forms.error === null &&
          responses.error === null
        }
        offline={!online}
        latest={latest}
        history={historyRows(list)}
        sentTo={sentToRows(forms.data ?? [])}
        onReview={(responseId) =>
          router.push({
            pathname: "/(app)/clients/[id]/responses/[responseId]",
            params: {
              id: p.clientId,
              responseId,
              ...(p.clientName ? { name: p.clientName } : {}),
            },
          } as never)
        }
        onOpenForm={(formId) => {
          const form = forms.data?.find((f) => f.form.id === formId);
          if (form) setSetup(initialSetup(form));
        }}
        onAddForm={() => setPicking(true)}
      />
      {setup ? (
        <ClientSetupSheetPresenter
          visible
          onClose={() => setSetup(null)}
          firstName={firstName}
          formTitle={setup.form.form.title}
          status={status}
          clientTrigger={
            CLIENT_TRIGGERS.includes(setup.baseTrigger)
              ? (setup.trigger as ClientTrigger)
              : null
          }
          onClientTrigger={(t) =>
            setSetup({
              ...setup,
              trigger: t,
              rule: t === setup.trigger ? setup.rule : defaultRule(t),
            })
          }
          trigger={setup.trigger}
          rule={setup.rule}
          onRule={(rule) => setSetup({ ...setup, rule })}
          paused={setupPaused(setup.form)}
          canSave={
            setup.trigger === "weekly"
              ? !!setup.rule.weekday && !!setup.rule.timeLocal
              : setup.trigger === "daily"
                ? !!setup.rule.timeLocal
                : true
          }
          offline={!online}
          onPause={() =>
            void runSetup(setup.form.form.id, setupPauseInputs(setup.form))
          }
          // Stop names no rule: this client leaves every rule of the form.
          onStop={() =>
            void runSetup(setup.form.form.id, [{ status: "excluded" }])
          }
          onSave={() =>
            void runSetup(setup.form.form.id, [setupSaveInput(setup)])
          }
        />
      ) : null}
      {picking ? (
        <FormPickerSheetPresenter
          visible
          onClose={() => setPicking(false)}
          firstName={firstName}
          forms={(library.data?.forms ?? [])
            .filter((f) => f.archivedAt === null)
            .map((f) => ({
              id: f.id,
              title: f.title,
              subtitle: plural(questionCount(f), "question"),
            }))}
          onPick={(formId) => {
            setPicking(false);
            router.push({
              pathname: "/(app)/coach-forms/[id]",
              params: { id: formId, send: "1", sendTo: p.clientId },
            } as never);
          }}
          onNewForm={() => {
            setPicking(false);
            router.push("/(app)/coach-forms/edit" as never);
          }}
        />
      ) : null}
    </>
  );
}
