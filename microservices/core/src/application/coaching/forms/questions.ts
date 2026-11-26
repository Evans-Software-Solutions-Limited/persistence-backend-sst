import { COACH_FORM_LIMITS } from "@persistence/form-limits";
import { stripNul } from "../../shared/stripNul";
import { photoAnswerMediaId } from "../../media/privateMediaRepository";

/**
 * Question and answer validators for coach forms (PER-116, design C D1).
 *
 * Questions are checked strictly when a version is created, and stored in
 * their normalised form. Answers are checked against the REQUEST's own
 * version, so editing a form never changes what an earlier request asked.
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

// Shared with the web and mobile form editors (PER-147).
export const MAX_QUESTIONS = COACH_FORM_LIMITS.maxQuestions;
export const MAX_PROMPT = COACH_FORM_LIMITS.promptMax;
export const MIN_OPTIONS = COACH_FORM_LIMITS.minOptions;
export const MAX_OPTIONS = COACH_FORM_LIMITS.maxOptions;
export const MAX_OPTION_LENGTH = COACH_FORM_LIMITS.optionMax;
export const MAX_UNIT_LENGTH = COACH_FORM_LIMITS.unitMax;
export const MAX_SHORT_TEXT = 500;
export const MAX_LONG_TEXT = 5000;
export const SCALE_MIN = 1;
export const SCALE_MAX = 5;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_HELP = COACH_FORM_LIMITS.helpMax;
export const MAX_DETAILS = 500;

/**
 * PER-129 (C10b "Filled for them"): what the athlete's app fills in from
 * what they already log. They can still change it before sending. Each
 * source fits one answer type; `weight` and `progress_photos` also save to
 * Body / Photos on the athlete's side (PER-130).
 */
export const PREFILL_SOURCES = {
  sessions_done: "number",
  meal_plan_followed: "number",
  steps: "number",
  weight: "number",
  progress_photos: "photo",
} as const satisfies Record<string, QuestionType>;
export type PrefillSource = keyof typeof PREFILL_SOURCES;

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  /** Help text under the prompt (PER-129, C10b). */
  help?: string;
  /** yes/no only: show a details box when they answer yes (C10b). */
  detailsIfYes?: boolean;
  /** Filled for them from what they already log (C10b). */
  prefill?: PrefillSource;
}

export interface FieldError {
  /** Index of the question (questions) or its id (answers). */
  at: number | string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function isQuestionType(v: unknown): v is QuestionType {
  return (
    typeof v === "string" && (QUESTION_TYPES as readonly string[]).includes(v)
  );
}

const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set([
  "single_choice",
  "multiple_choice",
]);

function validateQuestion(
  raw: unknown,
  index: number,
  errors: FieldError[],
): Question | null {
  const fail = (message: string) => {
    errors.push({ at: index, message });
    return null;
  };
  if (!isRecord(raw)) return fail("must be an object");
  const allowed = new Set([
    "id",
    "type",
    "prompt",
    "required",
    "options",
    "min",
    "max",
    "unit",
    "help",
    "detailsIfYes",
    "prefill",
  ]);
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return fail(`unknown field ${unknown[0]}`);
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
    return fail("id must be 1–64 letters, digits, - or _");
  }
  if (!isQuestionType(raw.type)) {
    return fail(`type must be one of ${QUESTION_TYPES.join(", ")}`);
  }
  const prompt =
    typeof raw.prompt === "string" ? stripNul(raw.prompt).trim() : "";
  if (prompt.length === 0 || prompt.length > MAX_PROMPT) {
    return fail(`prompt must be 1–${MAX_PROMPT} characters`);
  }
  if (raw.required !== undefined && typeof raw.required !== "boolean") {
    return fail("required must be a boolean");
  }
  const question: Question = {
    id: raw.id,
    type: raw.type,
    prompt,
    required: raw.required === true,
  };

  if (CHOICE_TYPES.has(raw.type)) {
    if (!Array.isArray(raw.options)) {
      return fail(`options are required (${MIN_OPTIONS}–${MAX_OPTIONS})`);
    }
    if (raw.options.length < MIN_OPTIONS || raw.options.length > MAX_OPTIONS) {
      return fail(`options must have ${MIN_OPTIONS}–${MAX_OPTIONS} entries`);
    }
    const options: string[] = [];
    for (const o of raw.options) {
      const text = typeof o === "string" ? stripNul(o).trim() : "";
      if (text.length === 0 || text.length > MAX_OPTION_LENGTH) {
        return fail(`each option must be 1–${MAX_OPTION_LENGTH} characters`);
      }
      if (options.includes(text)) return fail("options must be unique");
      options.push(text);
    }
    question.options = options;
  } else if (raw.options !== undefined) {
    return fail("only choice questions have options");
  }

  if (raw.type === "number") {
    if (raw.min !== undefined) {
      if (!isFiniteNumber(raw.min)) return fail("min must be a number");
      question.min = raw.min;
    }
    if (raw.max !== undefined) {
      if (!isFiniteNumber(raw.max)) return fail("max must be a number");
      question.max = raw.max;
    }
    if (
      question.min !== undefined &&
      question.max !== undefined &&
      question.min > question.max
    ) {
      return fail("min must not be above max");
    }
    if (raw.unit !== undefined) {
      const unit =
        typeof raw.unit === "string" ? stripNul(raw.unit).trim() : "";
      if (unit.length === 0 || unit.length > MAX_UNIT_LENGTH) {
        return fail(`unit must be 1–${MAX_UNIT_LENGTH} characters`);
      }
      question.unit = unit;
    }
  } else if (
    raw.min !== undefined ||
    raw.max !== undefined ||
    raw.unit !== undefined
  ) {
    return fail("only number questions have min, max or unit");
  }

  if (raw.help !== undefined && raw.help !== null) {
    if (typeof raw.help !== "string") return fail("help must be text");
    const help = stripNul(raw.help).trim();
    if (help.length > MAX_HELP) {
      return fail(`help must be at most ${MAX_HELP} characters`);
    }
    if (help.length > 0) question.help = help;
  }
  if (raw.detailsIfYes !== undefined) {
    if (typeof raw.detailsIfYes !== "boolean") {
      return fail("detailsIfYes must be a boolean");
    }
    if (raw.type !== "yes_no" && raw.detailsIfYes) {
      return fail("only yes/no questions ask for details");
    }
    if (raw.detailsIfYes) question.detailsIfYes = true;
  }
  if (raw.prefill !== undefined && raw.prefill !== null) {
    if (
      typeof raw.prefill !== "string" ||
      !Object.hasOwn(PREFILL_SOURCES, raw.prefill)
    ) {
      return fail(
        `prefill must be one of ${Object.keys(PREFILL_SOURCES).join(", ")}`,
      );
    }
    const source = raw.prefill as PrefillSource;
    if (PREFILL_SOURCES[source] !== raw.type) {
      return fail(
        `prefill ${source} needs a ${PREFILL_SOURCES[source]} question`,
      );
    }
    question.prefill = source;
  }
  return question;
}

/** Strict schema for a new version's questions. */
export function validateQuestions(raw: unknown): ValidationResult<Question[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ at: -1, message: "must be an array" }] };
  }
  if (raw.length === 0 || raw.length > MAX_QUESTIONS) {
    return {
      ok: false,
      errors: [{ at: -1, message: `1–${MAX_QUESTIONS} questions` }],
    };
  }
  const errors: FieldError[] = [];
  const questions: Question[] = [];
  const ids = new Set<string>();
  raw.forEach((q, i) => {
    const question = validateQuestion(q, i, errors);
    if (!question) return;
    if (ids.has(question.id)) {
      errors.push({ at: i, message: `duplicate id ${question.id}` });
      return;
    }
    ids.add(question.id);
    questions.push(question);
  });
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: questions };
}

export type AnswersResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: FieldError[] };

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

function checkAnswer(
  q: Question,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  switch (q.type) {
    case "short_text":
    case "long_text": {
      const max = q.type === "short_text" ? MAX_SHORT_TEXT : MAX_LONG_TEXT;
      if (typeof value !== "string") return { ok: false, message: "text" };
      const text = stripNul(value).trim();
      return text.length > max
        ? { ok: false, message: `at most ${max} characters` }
        : { ok: true, value: text };
    }
    case "number":
      if (!isFiniteNumber(value)) return { ok: false, message: "a number" };
      if (q.min !== undefined && value < q.min) {
        return { ok: false, message: `at least ${q.min}` };
      }
      if (q.max !== undefined && value > q.max) {
        return { ok: false, message: `at most ${q.max}` };
      }
      return { ok: true, value };
    case "scale":
      return Number.isInteger(value) &&
        (value as number) >= SCALE_MIN &&
        (value as number) <= SCALE_MAX
        ? { ok: true, value }
        : { ok: false, message: `a whole number ${SCALE_MIN}–${SCALE_MAX}` };
    case "single_choice":
      return typeof value === "string" && q.options!.includes(value)
        ? { ok: true, value }
        : { ok: false, message: "one of the options" };
    case "multiple_choice": {
      if (!Array.isArray(value)) {
        return { ok: false, message: "a list of options" };
      }
      const picked = new Set<string>();
      for (const v of value) {
        if (typeof v !== "string" || !q.options!.includes(v)) {
          return { ok: false, message: "a list of options" };
        }
        picked.add(v);
      }
      // Keep the coach's option order, without duplicates.
      return { ok: true, value: q.options!.filter((o) => picked.has(o)) };
    }
    case "yes_no": {
      if (typeof value === "boolean") return { ok: true, value };
      // PER-129: a details-if-yes question may send `{value, details}`.
      // Stored as that object only when there are details to keep.
      if (
        q.detailsIfYes &&
        isRecord(value) &&
        typeof value.value === "boolean"
      ) {
        const extra = Object.keys(value).filter(
          (k) => k !== "value" && k !== "details",
        );
        if (extra.length > 0) return { ok: false, message: "true or false" };
        if (value.details !== undefined && typeof value.details !== "string") {
          return { ok: false, message: "details as text" };
        }
        const details =
          value.value && typeof value.details === "string"
            ? stripNul(value.details).trim()
            : "";
        if (details.length > MAX_DETAILS) {
          return {
            ok: false,
            message: `details of at most ${MAX_DETAILS} characters`,
          };
        }
        return {
          ok: true,
          value: details ? { value: value.value, details } : value.value,
        };
      }
      return { ok: false, message: "true or false" };
    }
    case "photo": {
      // PER-121: a photo answer is the media id of a `form_answer` upload
      // (`POST /users/me/media/uploads`), as `{mediaId}` or a bare id.
      // Ownership and upload state are checked when the response is saved.
      const mediaId = photoAnswerMediaId(value);
      return mediaId
        ? { ok: true, value: { mediaId } }
        : { ok: false, message: "an uploaded photo ({ mediaId })" };
    }
  }
}

/**
 * Check `answers` ({questionId: value}) against a version's questions.
 * Unanswered optional questions are left out of the stored answers.
 */
export function validateAnswers(
  questions: Question[],
  raw: unknown,
): AnswersResult {
  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [{ at: "", message: "answers must be an object" }],
    };
  }
  const errors: FieldError[] = [];
  const known = new Set(questions.map((q) => q.id));
  for (const id of Object.keys(raw)) {
    if (!known.has(id)) errors.push({ at: id, message: "unknown question" });
  }
  const value: Record<string, unknown> = {};
  for (const q of questions) {
    // Own keys only: an id like `constructor` must not read Object.prototype.
    const given = Object.hasOwn(raw, q.id) ? raw[q.id] : undefined;
    if (isBlank(given)) {
      if (!q.required) continue;
      errors.push({ at: q.id, message: "required" });
      continue;
    }
    const checked = checkAnswer(q, given);
    if (!checked.ok) {
      errors.push({ at: q.id, message: `must be ${checked.message}` });
      continue;
    }
    if (isBlank(checked.value)) {
      if (q.required) errors.push({ at: q.id, message: "required" });
      continue;
    }
    // defineProperty, not assignment: an id of `__proto__` would otherwise
    // hit Object.prototype's setter and drop the answer (Inspector Brad, #543).
    Object.defineProperty(value, q.id, {
      value: checked.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
