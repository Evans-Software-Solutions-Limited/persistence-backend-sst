import { stripNul } from "../../shared/stripNul";

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

export const MAX_QUESTIONS = 40;
export const MAX_PROMPT = 300;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 12;
export const MAX_OPTION_LENGTH = 100;
export const MAX_UNIT_LENGTH = 20;
export const MAX_SHORT_TEXT = 500;
export const MAX_LONG_TEXT = 5000;
export const SCALE_MIN = 1;
export const SCALE_MAX = 5;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
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
  | { ok: false; photo: boolean; errors: FieldError[] };

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
    case "yes_no":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { ok: false, message: "true or false" };
    case "photo":
      // Photo answers use BE-F1's media upload (PER-121). Until it ships a
      // photo question can be created but not answered.
      return { ok: false, message: "a photo, which can't be answered yet" };
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
      photo: false,
      errors: [{ at: "", message: "answers must be an object" }],
    };
  }
  const errors: FieldError[] = [];
  let photo = false;
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
      // A required photo can't be answered until BE-F1 either.
      photo ||= q.type === "photo";
      errors.push({ at: q.id, message: "required" });
      continue;
    }
    const checked = checkAnswer(q, given);
    if (!checked.ok) {
      photo ||= q.type === "photo";
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
  return errors.length > 0 ? { ok: false, photo, errors } : { ok: true, value };
}
