import type {
  ClientProfileDetail,
  CoachForm,
  FormSchedule,
  Invite,
  MealPlan,
  RuleOverride,
  SetupItem,
  SetupSection,
} from "../api/types";
import { firstName } from "./people";
import { effectiveRule, ruleDetail, ruleSummary } from "./schedule";

/**
 * The C11 set-up checklist: which sections the web shows, their labels and
 * the one-line summaries used on the checklist (C11b) and on the invited
 * client's Overview (C11d). Pure functions over the profile and the coach's
 * library.
 */

/**
 * Sections with a web editor, in the canvas order. Programme (PER-112) and
 * resources (PER-122) have no live backend handler yet, so they are not
 * listed; when their tickets ship, add them here with an editor. A section
 * that still answers 422 `section_unavailable` is hidden at run time too.
 */
export const WEB_SECTIONS: readonly SetupSection[] = [
  "starter_form",
  "repeating_form",
  "nutrition_target",
  "meal_plan",
  "welcome_message",
];

export const SECTION_TITLE: Record<SetupSection, string> = {
  starter_form: "Starter forms",
  repeating_form: "Repeating check-ins",
  programme: "Programme",
  nutrition_target: "Calorie and macro targets",
  meal_plan: "Meal plan",
  resource: "Resources",
  welcome_message: "Welcome message",
};

/** The coach's library, looked up by id. */
export interface Library {
  forms: Map<string, CoachForm>;
  schedules: Map<string, FormSchedule>;
  plans: Map<string, MealPlan>;
}

export function emptyLibrary(): Library {
  return { forms: new Map(), schedules: new Map(), plans: new Map() };
}

export function buildLibrary(
  forms: CoachForm[] | undefined,
  schedules: FormSchedule[] | undefined,
  plans: MealPlan[] | undefined,
): Library {
  return {
    forms: new Map((forms ?? []).map((f) => [f.id, f])),
    schedules: new Map((schedules ?? []).map((s) => [s.id, s])),
    plans: new Map((plans ?? []).map((p) => [p.id, p])),
  };
}

export function itemsOf(
  detail: Pick<ClientProfileDetail, "setup">,
  section: SetupSection,
): SetupItem[] {
  return [...(detail.setup[section] ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}

const kcalFmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
export const formatKcal = (n: number) => kcalFmt.format(n);

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formTitle(lib: Library, formId: string | null): string {
  return (formId && lib.forms.get(formId)?.title) || "Form";
}

export function scheduleTitle(lib: Library, scheduleId: string | null): string {
  const schedule = scheduleId ? lib.schedules.get(scheduleId) : undefined;
  return schedule ? formTitle(lib, schedule.formId) : "Check-in";
}

export function targetNumbers(item: SetupItem | undefined) {
  if (!item) return null;
  const c = item.config;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const kcal = num(c.dailyKcal);
  if (kcal === null) return null;
  return {
    dailyKcal: kcal,
    proteinG: num(c.proteinG) ?? 0,
    carbsG: num(c.carbsG) ?? 0,
    fatG: num(c.fatG) ?? 0,
  };
}

/** The checklist line under each section (C11b). */
export function checklistSummary(
  section: SetupSection,
  items: SetupItem[],
  lib: Library,
  clientName: string,
): string {
  if (items.length === 0) return "Not added";
  const name = firstName(clientName);
  switch (section) {
    case "starter_form":
      return `${plural(items.length, "form", "forms")} · sent when ${name} joins`;
    case "repeating_form": {
      if (items.length > 1)
        return plural(items.length, "check-in", "check-ins");
      const schedule = items[0].refId
        ? lib.schedules.get(items[0].refId)
        : undefined;
      return schedule
        ? ruleSummary(
            effectiveRule(schedule, items[0].config.override as RuleOverride),
          )
        : scheduleTitle(lib, items[0].refId);
    }
    case "nutrition_target": {
      const t = targetNumbers(items[0]);
      return t
        ? `${formatKcal(t.dailyKcal)} kcal · ${formatKcal(t.proteinG)} g protein`
        : "Added";
    }
    case "meal_plan":
      return items.length === 1
        ? (lib.plans.get(items[0].refId ?? "")?.name ?? "1 plan")
        : plural(items.length, "plan", "plans");
    case "welcome_message":
      return `“${truncate(String(items[0].config.text ?? ""), 25)}”`;
    default:
      return plural(items.length, "item", "items");
  }
}

/** The fuller line on the invited client's Overview (C11d). */
export function overviewSummary(
  section: SetupSection,
  items: SetupItem[],
  lib: Library,
): string {
  if (items.length === 0) return "Not added";
  switch (section) {
    case "starter_form":
      return items.map((i) => formTitle(lib, i.refId)).join(" · ");
    case "repeating_form":
      return items
        .map((i) => {
          const s = i.refId ? lib.schedules.get(i.refId) : undefined;
          return s
            ? ruleDetail(effectiveRule(s, i.config.override as RuleOverride))
            : scheduleTitle(lib, i.refId);
        })
        .join(" · ");
    case "nutrition_target": {
      const t = targetNumbers(items[0]);
      return t
        ? `${formatKcal(t.dailyKcal)} kcal · ${formatKcal(t.proteinG)} g protein · ${formatKcal(t.carbsG)} g carbs · ${formatKcal(t.fatG)} g fat`
        : "Added";
    }
    case "meal_plan":
      return items
        .map((i) => lib.plans.get(i.refId ?? "")?.name ?? "Meal plan")
        .join(" · ");
    case "welcome_message":
      return `“${truncate(String(items[0].config.text ?? ""), 48)}”`;
    default:
      return plural(items.length, "item", "items");
  }
}

/** Overview row title: a single check-in shows its form's name. */
export function overviewTitle(
  section: SetupSection,
  items: SetupItem[],
  lib: Library,
): string {
  if (section === "repeating_form" && items.length === 1) {
    return scheduleTitle(lib, items[0].refId);
  }
  return SECTION_TITLE[section];
}

export function checklistCount(
  detail: Pick<ClientProfileDetail, "setup">,
  sections: readonly SetupSection[],
): { done: number; total: number } {
  return {
    done: sections.filter((s) => (detail.setup[s] ?? []).length > 0).length,
    total: sections.length,
  };
}

// ─── Invite state ────────────────────────────────────────────────────────────

export type InviteState = "none" | "active" | "expired" | "used";

export function inviteState(
  invite: Pick<Invite, "status" | "expiresAt"> | null | undefined,
  now: number = Date.now(),
): InviteState {
  if (!invite) return "none";
  if (invite.status === "used") return "used";
  if (invite.status === "expired") return "expired";
  const t = new Date(invite.expiresAt).getTime();
  return !Number.isNaN(t) && t <= now ? "expired" : "active";
}

/** Same rule for the roster's summary rows. */
export function summaryInviteState(
  status: "active" | "used" | "expired" | "not_sent",
  expiresAt: string | null,
  now: number = Date.now(),
): InviteState {
  if (status === "not_sent") return "none";
  return inviteState({ status, expiresAt: expiresAt ?? "" }, now);
}

// ─── Forms ───────────────────────────────────────────────────────────────────

const QUESTION_TYPE_LABEL: Record<string, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  scale: "Scale 1–5",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  photo: "Photo",
  yes_no: "Yes / no",
};

export function questionTypeLabel(type: string): string {
  return QUESTION_TYPE_LABEL[type] ?? type;
}

export function questionCount(form: CoachForm | undefined): number {
  return form?.version?.questions.length ?? 0;
}

/** "14 questions · about 7 min": roughly 30 seconds a question. */
export function formMeta(form: CoachForm | undefined): string {
  const n = questionCount(form);
  const mins = Math.max(1, Math.round(n / 2));
  return `${plural(n, "question", "questions")} · about ${mins} min`;
}

export function planMeta(plan: MealPlan | undefined): string {
  if (!plan) return "";
  return `${plural(plan.meals.length, "meal", "meals")} · about ${formatKcal(plan.totals.kcal)} kcal`;
}

// ─── Invite step (C11c) ──────────────────────────────────────────────────────

/** "When Lena accepts, they get": one line per thing that is ready. */
export function readyLines(
  detail: Pick<ClientProfileDetail, "setup">,
  lib: Library,
): string[] {
  const lines: string[] = [];
  if (itemsOf(detail, "welcome_message").length > 0) {
    lines.push("Your welcome message");
  }
  const forms = itemsOf(detail, "starter_form").length;
  if (forms > 0)
    lines.push(`${plural(forms, "form", "forms")} to fill in first`);
  const t = targetNumbers(itemsOf(detail, "nutrition_target")[0]);
  if (t) {
    lines.push(
      `Targets: ${formatKcal(t.dailyKcal)} kcal · ${formatKcal(t.proteinG)} g protein`,
    );
  }
  for (const item of itemsOf(detail, "meal_plan")) {
    lines.push(lib.plans.get(item.refId ?? "")?.name ?? "A meal plan");
  }
  for (const item of itemsOf(detail, "repeating_form")) {
    const s = item.refId ? lib.schedules.get(item.refId) : undefined;
    const title = scheduleTitle(lib, item.refId);
    if (!s) {
      lines.push(title);
      continue;
    }
    const r = effectiveRule(s, item.config.override as RuleOverride);
    const when =
      r.trigger === "weekly" && r.weekday && r.timeLocal
        ? `${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][r.weekday - 1]} ${r.timeLocal}`
        : r.trigger === "daily" && r.timeLocal
          ? `daily ${r.timeLocal}`
          : "once";
    lines.push(`${title}, ${when}`);
  }
  return lines;
}

/** Whole days left on a code (rounded up), never below 0. */
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 86_400_000));
}

/** A ready-written email for "Email Lena" (opens the coach's mail app). */
export function inviteMailto(opts: {
  email: string;
  clientFirst: string;
  coachName: string;
  code: string;
  link: string;
  days: number;
}): string {
  const subject = `Your coaching invite from ${opts.coachName}`;
  const body = [
    `Hi ${opts.clientFirst},`,
    "",
    "I've set up your coaching on Persistence. To join, open the Persistence app and enter this code:",
    "",
    opts.code,
    "",
    `Or open this link on your phone: ${opts.link}`,
    "",
    `The code works for ${opts.days === 1 ? "1 more day" : `${opts.days} days`}.`,
    "",
    opts.coachName,
  ].join("\n");
  return `mailto:${encodeURIComponent(opts.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
