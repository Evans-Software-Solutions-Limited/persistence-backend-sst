/**
 * PER-129 (APP-C1): coach forms (C10), send rules and the Check-ins tab
 * (C3.3). Shapes mirror the backend DTOs in
 * `microservices/core/src/application/coaching/forms/` (FormDTO, ScheduleDTO,
 * ClientFormDTO, ResponseDTO, the stats DTOs and `Question`).
 */

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "number",
  "scale",
  "single_choice",
  "multiple_choice",
  "photo",
  "yes_no",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** "Filled for them" sources and the one answer type each fits (C10b). */
export const PREFILL_SOURCES = {
  sessions_done: "number",
  meal_plan_followed: "number",
  steps: "number",
  weight: "number",
  progress_photos: "photo",
} as const satisfies Record<string, QuestionType>;
export type PrefillSource = keyof typeof PREFILL_SOURCES;

export const MAX_QUESTIONS = 40;
export const MAX_PROMPT = 300;
export const MAX_HELP = 300;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 12;
export const MAX_UNIT = 20;
export const TITLE_MAX = 120;
export const MAX_REMINDERS = 5;
export const MAX_REMINDER_HOURS = 720;
export const MAX_DUE_HOURS = 2160;
export const REPLY_MAX = 2000;

export type Question = {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  help?: string;
  detailsIfYes?: boolean;
  prefill?: PrefillSource;
};

export type FormVersion = {
  id: string;
  version: number;
  questions: Question[];
  createdAt: string;
};

/** `FormDTO`: a form plus its current version. */
export type CoachForm = {
  id: string;
  title: string;
  description: string | null;
  templateKey: string | null;
  available: boolean;
  /** Optimistic-concurrency revision; sent back as `expectedRevision`. */
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: FormVersion | null;
};

/** `GET /trainers/me/forms?include=templates`. */
export type CoachFormsLibrary = {
  forms: CoachForm[];
  templates: CoachForm[];
  asOf: string;
};

export const FORM_TRIGGERS = [
  "on_join",
  "once",
  "weekly",
  "daily",
  "on_end",
] as const;
export type FormTrigger = (typeof FORM_TRIGGERS)[number];
export type FormAudience = "all_clients" | "selected";
/** The cadences one client's rule can switch between (C10j). */
export type ClientTrigger = "once" | "weekly" | "daily";

export type Reminder = { afterHours: number };

/** The rule fields a schedule (or a per-client override) carries. */
export type RuleFields = {
  weekday: number | null;
  timeLocal: string | null;
  dueAfterHours: number | null;
  reminders: Reminder[];
};

export type ScheduleClient = {
  clientId: string;
  relationshipId: string;
  status: string;
  override: Record<string, unknown> | null;
};

/** `ScheduleDTO`: one send rule. */
export type FormSchedule = RuleFields & {
  id: string;
  formId: string;
  trigger: FormTrigger;
  audience: FormAudience;
  status: "active" | "paused" | "stopped";
  revision: number;
  clients: ScheduleClient[];
  createdAt: string;
  updatedAt: string;
};

export type FormStatsClient = {
  clientId: string;
  name: string | null;
  requestId: string;
  status: "done" | "pending" | "missed";
  late: boolean;
  sentAt: string;
  dueAt: string | null;
  completedAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
};

export type FormStats = {
  formId: string;
  reached: number;
  done: number;
  outstanding: number;
  clients: FormStatsClient[];
};

export type FormStatsTotals = {
  forms: number;
  repeating: number;
  outstanding: number;
  onTimeRate: number | null;
  onTimeSample: number;
};

/** `GET /trainers/me/forms/stats`. */
export type CoachFormStats = {
  forms: FormStats[];
  totals: FormStatsTotals;
  asOf: string;
};

/** `ClientFormRuleDTO`: one live rule as it applies to one client. */
export type ClientFormRule = RuleFields & {
  scheduleId: string;
  trigger: FormTrigger;
  audience: FormAudience;
  status: string;
  clientStatus: string | null;
  override: Record<string, unknown> | null;
};

/** `ClientFormDTO`: a form this coach sends to one client (C3.3 "Sent to"). */
export type ClientForm = {
  form: { id: string; title: string; archivedAt: string | null };
  rule: ClientFormRule | null;
  rules: ClientFormRule[];
  lastDoneAt: string | null;
  lastSentAt: string | null;
  pendingRequestId: string | null;
  state: "done" | "notDoneYet" | "paused";
};

/** `ResponseDTO`, with the questions of the version it answered. */
export type FormResponse = {
  id: string;
  requestId: string;
  formId: string;
  title: string;
  trigger: FormTrigger;
  periodKey: string;
  sentAt: string;
  submittedAt: string;
  late: boolean;
  answers: Record<string, unknown>;
  reviewedAt: string | null;
  replyText: string | null;
  version: { id: string; version: number; questions: Question[] };
};

export type FormResponsesPage = {
  responses: FormResponse[];
  nextCursor: string | null;
};

/** The editor's draft (C10b). `id` is absent for a new form. */
export type FormDraft = {
  id?: string;
  title: string;
  description: string | null;
  questions: Question[];
};

/** C10h: what the send sheet saves. `scheduleId` edits an existing rule. */
export type ScheduleDraft = RuleFields & {
  scheduleId?: string;
  formId: string;
  trigger: FormTrigger;
  audience: FormAudience;
  clientIds: string[];
};

/** C10j: `PUT /trainers/me/clients/:clientId/forms/:formId/setup`. */
export type ClientSetupInput = {
  status: "active" | "paused" | "excluded";
  override?: (Partial<RuleFields> & { trigger?: ClientTrigger | null }) | null;
  scheduleId?: string;
};

/** A 409 the queue resolved by taking the server copy. */
export type CoachFormConflict = { key: string; at: string };

/** Conflict keys: one per form or send rule. */
export const formConflictKey = (formId: string) => `form:${formId}`;
export const scheduleConflictKey = (scheduleId: string) =>
  `schedule:${scheduleId}`;

/** Exact copy for a 409 `revision_conflict` (PER-129 BRIEF). */
export const EDITED_ELSEWHERE = "Edited on another device";
