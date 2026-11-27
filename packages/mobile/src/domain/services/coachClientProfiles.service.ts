/**
 * PER-125 (APP-A2): pure helpers for the iPhone add-client flow (C11f–s),
 * the invited client (C11i) and C3.9 settings. The same rules as the web
 * coach workspace (`packages/web/src/coach/lib/{people,setup,settings}.ts`).
 *
 * The canvas writes "she"/"her" for its sample client. The app never knows a
 * client's pronouns, so copy uses the client's first name instead (as web).
 */
import type {
  ClientProfileDetail,
  ClientSettings,
  FeatureKey,
  Invite,
  SettingsPatch,
  SetupItem,
  SetupMealPlan,
  SetupResource,
  SetupSection,
} from "@/domain/models/coachClientProfiles";
import type {
  CoachForm,
  FormSchedule,
  FormTrigger,
  RuleFields,
} from "@/domain/models/coachForms";
import type { ProgramSummary } from "@/domain/models/program";
import {
  WEEKDAYS_SHORT,
  plural,
  questionCount,
} from "@/domain/services/coachForms.service";

// ── Names and contact ────────────────────────────────────────────────────────

export function joinName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}

/** A stored display name back into first / last for editing. */
export function splitName(displayName: string): {
  first: string;
  last: string;
} {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

export function firstName(displayName: string): string {
  return splitName(displayName).first || "your client";
}

export function profileInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export const EMAIL_PATTERN = String.raw`^[^\s@]+@[^\s@]+\.[^\s@]+$`;
export const PHONE_PATTERN = String.raw`^\+?[0-9 ()-]{6,}$`;

export type ContactParse =
  | { kind: "empty" }
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "invalid" };

/** The single "Email or mobile" field → the profile's two columns. */
export function parseContact(raw: string): ContactParse {
  const value = raw.trim();
  if (value === "") return { kind: "empty" };
  if (value.includes("@")) {
    return new RegExp(EMAIL_PATTERN).test(value) && value.length <= 320
      ? { kind: "email", value }
      : { kind: "invalid" };
  }
  return new RegExp(PHONE_PATTERN).test(value) && value.length <= 40
    ? { kind: "phone", value }
    : { kind: "invalid" };
}

export function contactOf(profile: {
  contactEmail: string | null;
  contactPhone: string | null;
}): string {
  return profile.contactEmail ?? profile.contactPhone ?? "";
}

// ── Set-up sections ──────────────────────────────────────────────────────────

/** The checklist rows on iPhone (C11g), in the canvas order. */
export const IPHONE_SECTIONS: readonly SetupSection[] = [
  "starter_form",
  "repeating_form",
  "programme",
  "nutrition_target",
  "meal_plan",
  "resource",
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

/** The coach's library, looked up by id, for the rows' names. */
export type SetupLibrary = {
  forms: Map<string, CoachForm>;
  schedules: Map<string, FormSchedule>;
  programmes: Map<string, ProgramSummary>;
  plans: Map<string, SetupMealPlan>;
  resources: Map<string, SetupResource>;
};

export function buildSetupLibrary(parts: {
  forms?: readonly CoachForm[] | null;
  schedules?: readonly FormSchedule[] | null;
  programmes?: readonly ProgramSummary[] | null;
  plans?: readonly SetupMealPlan[] | null;
  resources?: readonly SetupResource[] | null;
}): SetupLibrary {
  const byId = <T extends { id: string }>(rows?: readonly T[] | null) =>
    new Map((rows ?? []).map((r) => [r.id, r]));
  return {
    forms: byId(parts.forms),
    schedules: byId(parts.schedules),
    programmes: byId(parts.programmes),
    plans: byId(parts.plans),
    resources: byId(parts.resources),
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

/** Items renumbered in their shown order (the API's `sortOrder`). */
export function renumber(items: readonly SetupItem[]): SetupItem[] {
  return items.map((item, i) => ({ ...item, sortOrder: i }));
}

const kcalFmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
export const formatKcal = (n: number): string => kcalFmt.format(n);

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

/** The welcome message's text (C11r), or "" when there is none. */
export function welcomeText(item: SetupItem | undefined): string {
  const text = item?.config.text;
  return typeof text === "string" ? text : "";
}

export type TargetNumbers = {
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export function targetNumbers(
  item: SetupItem | undefined,
): TargetNumbers | null {
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

/** A check-in rule as this client gets it: the item's override wins. */
export type EffectiveRule = RuleFields & { trigger: FormTrigger };

export function ruleFor(
  schedule: FormSchedule,
  override: unknown,
): EffectiveRule {
  const o =
    typeof override === "object" && override !== null
      ? (override as Partial<RuleFields>)
      : {};
  return {
    trigger: schedule.trigger,
    weekday: o.weekday ?? schedule.weekday,
    timeLocal: o.timeLocal ?? schedule.timeLocal,
    dueAfterHours:
      o.dueAfterHours !== undefined ? o.dueAfterHours : schedule.dueAfterHours,
    reminders: o.reminders ?? schedule.reminders ?? [],
  };
}

/** Only the fields that differ from the rule go in the item's override. */
export function overrideFrom(
  schedule: FormSchedule,
  rule: RuleFields,
): Partial<RuleFields> | null {
  const o: Partial<RuleFields> = {};
  if (rule.weekday !== schedule.weekday) o.weekday = rule.weekday;
  if (rule.timeLocal !== schedule.timeLocal) o.timeLocal = rule.timeLocal;
  if (rule.dueAfterHours !== schedule.dueAfterHours) {
    o.dueAfterHours = rule.dueAfterHours;
  }
  const same =
    rule.reminders.length === schedule.reminders.length &&
    rule.reminders.every(
      (r, i) => r.afterHours === schedule.reminders[i]?.afterHours,
    );
  if (!same) o.reminders = rule.reminders;
  return Object.keys(o).length === 0 ? null : o;
}

const FREQUENCY: Partial<Record<FormTrigger, string>> = {
  once: "Once",
  weekly: "Weekly",
  daily: "Daily",
};

function reminderCount(n: number): string | null {
  return n > 0 ? plural(n, "reminder") : null;
}

function ruleWhen(rule: EffectiveRule): string | null {
  if (rule.trigger === "weekly" && rule.weekday && rule.timeLocal) {
    return `${WEEKDAYS_SHORT[rule.weekday - 1]} ${rule.timeLocal}`;
  }
  if (rule.trigger === "daily" && rule.timeLocal) return rule.timeLocal;
  return null;
}

/** C11g: "Weekly · Sun 09:00 · 2 reminders". */
export function ruleSummary(rule: EffectiveRule): string {
  return [
    FREQUENCY[rule.trigger] ?? null,
    ruleWhen(rule),
    reminderCount(rule.reminders.length),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** C11i: "Sun 09:00 · 2 reminders" under the check-in's own name. */
export function ruleShort(rule: EffectiveRule): string {
  return (
    [
      ruleWhen(rule) ?? FREQUENCY[rule.trigger],
      reminderCount(rule.reminders.length),
    ]
      .filter(Boolean)
      .join(" · ") || "Check-in"
  );
}

export function formTitle(lib: SetupLibrary, formId: string | null): string {
  return (formId && lib.forms.get(formId)?.title) || "Form";
}

export function scheduleTitle(
  lib: SetupLibrary,
  scheduleId: string | null,
): string {
  const schedule = scheduleId ? lib.schedules.get(scheduleId) : undefined;
  return schedule ? formTitle(lib, schedule.formId) : "Check-in";
}

/** "14 questions · about 7 min": roughly 30 seconds a question (as web). */
export function formMeta(form: CoachForm | undefined): string {
  const n = form ? questionCount(form) : 0;
  const mins = Math.max(1, Math.round(n / 2));
  return `${plural(n, "question")} · about ${mins} min`;
}

export function planMeta(plan: SetupMealPlan | undefined): string {
  if (!plan) return "";
  return `${plural(plan.meals.length, "meal")} · about ${formatKcal(
    plan.totals.kcal,
  )} kcal`;
}

/** "PDF", "Video", "Link", "Image", "File" for a library resource. */
export function resourceKind(resource: SetupResource | undefined): string {
  if (!resource) return "Resource";
  if (resource.kind === "link") return "Link";
  const mime = resource.mime ?? "";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("image/")) return "Image";
  return "File";
}

export function programmeMeta(programme: ProgramSummary | undefined): string {
  if (!programme) return "";
  return [
    programme.durationWeeks ? plural(programme.durationWeeks, "week") : null,
    `${plural(programme.daysPerWeek, "workout")} a week`,
    plural(programme.workoutCount, "workout"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The line under each checklist row (C11g). */
export function checklistSummary(
  section: SetupSection,
  items: readonly SetupItem[],
  lib: SetupLibrary,
  clientName: string,
): string {
  if (items.length === 0) return "Not added";
  const first = items[0]!;
  switch (section) {
    case "starter_form":
      return `${plural(items.length, "form")} · sent when ${firstName(
        clientName,
      )} joins`;
    case "repeating_form": {
      if (items.length > 1) return plural(items.length, "check-in");
      const schedule = first.refId ? lib.schedules.get(first.refId) : undefined;
      return schedule
        ? ruleSummary(ruleFor(schedule, first.config.override))
        : scheduleTitle(lib, first.refId);
    }
    case "programme":
      return items.length === 1
        ? (lib.programmes.get(first.refId ?? "")?.name ?? "1 programme")
        : plural(items.length, "programme");
    case "nutrition_target": {
      const t = targetNumbers(first);
      return t
        ? `${formatKcal(t.dailyKcal)} kcal · ${formatKcal(t.proteinG)} g protein`
        : "Added";
    }
    case "meal_plan":
      return items.length === 1
        ? (lib.plans.get(first.refId ?? "")?.name ?? "1 plan")
        : plural(items.length, "plan");
    case "resource":
      return plural(items.length, "resource");
    case "welcome_message":
      return `“${truncate(welcomeText(first), 25)}”`;
  }
}

/** One row of the invited client's "Ready when … accepts" (C11i). */
export type ReadyRow = { section: SetupSection; title: string; sub: string };

export function readyRows(
  detail: Pick<ClientProfileDetail, "setup">,
  lib: SetupLibrary,
): ReadyRow[] {
  const rows: ReadyRow[] = [];
  for (const section of IPHONE_SECTIONS) {
    const items = itemsOf(detail, section);
    if (items.length === 0) continue;
    const first = items[0]!;
    switch (section) {
      case "starter_form":
        rows.push({
          section,
          title: "Starter forms",
          sub: plural(items.length, "form"),
        });
        break;
      case "repeating_form": {
        const schedule =
          items.length === 1 && first.refId
            ? lib.schedules.get(first.refId)
            : undefined;
        rows.push(
          schedule
            ? {
                section,
                title: scheduleTitle(lib, first.refId),
                sub: ruleShort(ruleFor(schedule, first.config.override)),
              }
            : {
                section,
                title: "Check-ins",
                sub: plural(items.length, "check-in"),
              },
        );
        break;
      }
      case "nutrition_target":
        rows.push({
          section,
          title: "Targets",
          sub: checklistSummary(section, items, lib, ""),
        });
        break;
      case "welcome_message":
        rows.push({ section, title: "Welcome message", sub: "Ready to send" });
        break;
      default:
        rows.push({
          section,
          title: SECTION_TITLE[section],
          sub: checklistSummary(section, items, lib, ""),
        });
    }
  }
  return rows;
}

export function checklistCount(
  detail: Pick<ClientProfileDetail, "setup">,
  sections: readonly SetupSection[] = IPHONE_SECTIONS,
): { done: number; total: number } {
  return {
    done: sections.filter((s) => (detail.setup[s] ?? []).length > 0).length,
    total: sections.length,
  };
}

// ── Invite state ─────────────────────────────────────────────────────────────

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

/** Whole days left on a code (rounded up), never below 0. */
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 86_400_000));
}

export function expiresLine(days: number): string {
  if (days <= 0) return "expires today";
  return `expires in ${plural(days, "day")}`;
}

/** The message "Share invite" writes for the coach (C7e). */
export function inviteShareMessage(opts: {
  clientFirst: string;
  code: string;
  link: string;
}): string {
  return `Hi ${opts.clientFirst}, join me on Persistence: use code ${opts.code} or tap ${opts.link}`;
}

// ── C3.9 settings ────────────────────────────────────────────────────────────

export const DEFAULT_SESSIONS_PER_WEEK = 3;
export const SESSIONS_MIN = 1;
export const SESSIONS_MAX = 14;

export function clampSessions(n: number): number {
  return Math.min(SESSIONS_MAX, Math.max(SESSIONS_MIN, Math.round(n)));
}

/** Turning training tracking on needs a target; start at three a week. */
export function trainingPatch(
  settings: Pick<ClientSettings, "sessionsPerWeek">,
  on: boolean,
): SettingsPatch {
  return on && settings.sessionsPerWeek === null
    ? { trackTraining: true, sessionsPerWeek: DEFAULT_SESSIONS_PER_WEEK }
    : { trackTraining: on };
}

export function applySettingsPatch<T extends ClientSettings>(
  settings: T,
  patch: SettingsPatch,
): T {
  const features = { ...settings.features };
  for (const [key, on] of Object.entries(patch.features ?? {})) {
    if (typeof on === "boolean") features[key as FeatureKey] = on;
  }
  return {
    ...settings,
    ...(patch.trackTraining !== undefined
      ? { trackTraining: patch.trackTraining }
      : {}),
    ...(patch.trackCalories !== undefined
      ? { trackCalories: patch.trackCalories }
      : {}),
    ...(patch.sessionsPerWeek !== undefined
      ? { sessionsPerWeek: patch.sessionsPerWeek }
      : {}),
    ...(patch.alertMode !== undefined ? { alertMode: patch.alertMode } : {}),
    features,
  };
}

/** Two patches as one (a newer value wins; feature switches merge). */
export function mergeSettingsPatch(
  older: SettingsPatch,
  newer: SettingsPatch,
): SettingsPatch {
  const merged: SettingsPatch = { ...older, ...newer };
  if (older.features || newer.features) {
    merged.features = { ...older.features, ...newer.features };
  }
  return merged;
}
