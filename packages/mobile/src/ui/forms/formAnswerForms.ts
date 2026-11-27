import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Resolver } from "react-hook-form";
import { schemaResolver, type ServerFieldMap } from "@/shared/form";
import type {
  AnswerValue,
  PhotoAnswer,
  YesNoAnswer,
} from "@/domain/models/athleteForms";
import type { Question } from "@/domain/models/coachForms";

/**
 * PER-130 (C4f): an athlete filling in a coach's form, as a react-hook-form
 * with a TypeBox schema (the PER-147 pattern, see `coachFormForms.ts`).
 *
 * The schema is built from the request's own questions and checks what the
 * API's `validateAnswers` refuses (BE-C1 `questions.ts`), on the answers as
 * they will be sent. Fields are `q0`, `q1`… by question index: question ids
 * are the coach's, and an id like `__proto__` must never become a field.
 *
 * "This question needs an answer" is a `refine` rule rather than a required
 * property, so a blank number reports that and not "Enter a number."
 */

export type AnswerValues = Record<string, AnswerValue>;

/** The same limits as the API (`MAX_SHORT_TEXT`, `MAX_LONG_TEXT`, `MAX_DETAILS`). */
export const SHORT_TEXT_MAX = 500;
export const LONG_TEXT_MAX = 5000;
export const DETAILS_MAX = 500;
export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

export const REQUIRED_PROBLEM = "This question needs an answer.";
export const SERVER_PROBLEM = "Check this answer.";

export const fieldOf = (index: number) => `q${index}`;

/** A question's empty answer, as the screen holds it. */
export function emptyAnswer(q: Question): AnswerValue {
  switch (q.type) {
    case "short_text":
    case "long_text":
    case "number":
      return "";
    case "multiple_choice":
      return [];
    case "yes_no":
      return { value: null, details: "" };
    case "photo":
      return { uri: null, mediaId: null };
    default:
      return null;
  }
}

/** Default values for every question, with any saved draft on top. */
export function answerDefaults(
  questions: readonly Question[],
  saved: AnswerValues = {},
): AnswerValues {
  const out: AnswerValues = {};
  questions.forEach((q, i) => {
    const key = fieldOf(i);
    out[key] = Object.hasOwn(saved, key) ? saved[key]! : emptyAnswer(q);
  });
  return out;
}

const fmt = (n: number) => n.toLocaleString("en-GB");

function isYesNo(v: unknown): v is YesNoAnswer {
  return typeof v === "object" && v !== null && "details" in v;
}

function isPhoto(v: unknown): v is PhotoAnswer {
  return typeof v === "object" && v !== null && "uri" in v;
}

/**
 * The answer as the API takes it, or undefined when it's blank. A photo
 * that's on the phone but not uploaded yet prepares as `"local"`, so the
 * schema counts it as answered; `toApiAnswers` sends only media ids.
 */
export function prepareAnswer(
  q: Question,
  raw: AnswerValue | undefined,
): unknown {
  switch (q.type) {
    case "short_text":
    case "long_text": {
      const text = typeof raw === "string" ? raw.trim() : "";
      return text === "" ? undefined : text;
    }
    case "number": {
      const text = typeof raw === "string" ? raw.trim().replace(",", ".") : "";
      if (typeof raw === "number") return raw;
      if (text === "") return undefined;
      const n = Number(text);
      return Number.isFinite(n) ? n : text;
    }
    case "scale":
      return typeof raw === "number" ? raw : undefined;
    case "single_choice":
      return typeof raw === "string" && raw !== "" ? raw : undefined;
    case "multiple_choice":
      return Array.isArray(raw) && raw.length > 0
        ? (q.options ?? []).filter((o) => raw.includes(o))
        : undefined;
    case "yes_no": {
      if (!isYesNo(raw) || raw.value === null) return undefined;
      const details = raw.details.trim();
      return q.detailsIfYes && raw.value && details
        ? { value: true, details }
        : raw.value;
    }
    case "photo":
      if (!isPhoto(raw)) return undefined;
      if (raw.mediaId) return { mediaId: raw.mediaId };
      return raw.uri ? "local" : undefined;
  }
}

function answerSchema(q: Question): TSchema {
  switch (q.type) {
    case "short_text":
    case "long_text": {
      const max = q.type === "short_text" ? SHORT_TEXT_MAX : LONG_TEXT_MAX;
      return Type.String({
        maxLength: max,
        errorMessage: `Keep this under ${fmt(max)} characters.`,
      });
    }
    case "number":
      return Type.Number({
        ...(q.min !== undefined ? { minimum: q.min } : {}),
        ...(q.max !== undefined ? { maximum: q.max } : {}),
        errorMessage: {
          Number: "Enter a number.",
          NumberMinimum: `Enter ${fmt(q.min ?? 0)} or more.`,
          NumberMaximum: `Enter ${fmt(q.max ?? 0)} or less.`,
        },
      });
    case "scale":
      return Type.Integer({
        minimum: SCALE_MIN,
        maximum: SCALE_MAX,
        errorMessage: `Choose ${SCALE_MIN} to ${SCALE_MAX}.`,
      });
    case "single_choice":
      return Type.Union(
        (q.options ?? []).map((o) => Type.Literal(o)),
        { errorMessage: "Choose one of the options." },
      );
    case "multiple_choice":
      return Type.Array(
        Type.Union((q.options ?? []).map((o) => Type.Literal(o))),
        { errorMessage: "Choose from the options." },
      );
    case "yes_no":
      return Type.Union(
        [
          Type.Boolean(),
          Type.Object({
            value: Type.Boolean(),
            details: Type.String({ maxLength: DETAILS_MAX }),
          }),
        ],
        {
          errorMessage: `Keep the details under ${fmt(DETAILS_MAX)} characters.`,
        },
      );
    case "photo":
      return Type.Union([
        Type.Literal("local"),
        Type.Object({ mediaId: Type.String({ minLength: 1 }) }),
      ]);
  }
}

export type AnswerForm = {
  resolver: Resolver<AnswerValues>;
  /** The values the schema checks (blank answers left out). */
  prepare: (values: AnswerValues) => Record<string, unknown>;
  /** True when question `index` can be left: answered well, or optional and blank. */
  accepts: (values: AnswerValues, index: number) => boolean;
  /** `{ [question id]: answer }` for the API; photos by media id only. */
  toApiAnswers: (values: AnswerValues) => Record<string, unknown>;
  /** 422 `invalid_answers` → the question's field (`errors[].at` is its id). */
  serverMap: ServerFieldMap<AnswerValues>;
};

/** Everything the fill-in screen needs to validate one request's questions. */
export function answerForm(questions: readonly Question[]): AnswerForm {
  const properties: Record<string, TSchema> = {};
  questions.forEach((q, i) => {
    properties[fieldOf(i)] = Type.Optional(answerSchema(q));
  });
  const schema = Type.Object(properties);

  const prepare = (values: AnswerValues) => {
    const out: Record<string, unknown> = {};
    questions.forEach((q, i) => {
      const v = prepareAnswer(q, values[fieldOf(i)]);
      if (v !== undefined) out[fieldOf(i)] = v;
    });
    return out;
  };

  const refine = (prepared: Record<string, unknown>) => {
    const out: Record<string, string> = {};
    questions.forEach((q, i) => {
      if (q.required && !Object.hasOwn(prepared, fieldOf(i))) {
        out[fieldOf(i)] = REQUIRED_PROBLEM;
      }
    });
    return out;
  };

  const resolver = schemaResolver<AnswerValues>(schema, {
    prepare,
    refine: refine as (prepared: never) => Partial<Record<string, string>>,
  });

  const accepts = (values: AnswerValues, index: number) => {
    const q = questions[index];
    if (!q) return true;
    const v = prepareAnswer(q, values[fieldOf(index)]);
    if (v === undefined) return !q.required;
    return Value.Check(answerSchema(q), v);
  };

  const toApiAnswers = (values: AnswerValues) => {
    const out: Record<string, unknown> = {};
    questions.forEach((q, i) => {
      const v = prepareAnswer(q, values[fieldOf(i)]);
      if (v === undefined || v === "local") return;
      // defineProperty: a question id of `__proto__` stays an own key.
      Object.defineProperty(out, q.id, {
        value: v,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });
    return out;
  };

  const serverMap = Object.create(null) as ServerFieldMap<AnswerValues>;
  questions.forEach((q, i) => {
    serverMap[q.id] = { field: fieldOf(i), message: SERVER_PROBLEM };
  });

  return { resolver, prepare, accepts, toApiAnswers, serverMap };
}

/** Photo answers on the phone that still need uploading, by question index. */
export function photosToUpload(
  questions: readonly Question[],
  values: AnswerValues,
): { index: number; uri: string }[] {
  const out: { index: number; uri: string }[] = [];
  questions.forEach((q, i) => {
    const v = values[fieldOf(i)];
    if (q.type === "photo" && isPhoto(v) && v.uri && !v.mediaId) {
      out.push({ index: i, uri: v.uri });
    }
  });
  return out;
}

/** True when any photo question has a photo (uploaded or not). */
export function hasPhotoAnswer(
  questions: readonly Question[],
  values: AnswerValues,
): boolean {
  return questions.some((q, i) => {
    const v = values[fieldOf(i)];
    return q.type === "photo" && isPhoto(v) && (!!v.uri || !!v.mediaId);
  });
}

/** The index of the first question with an error, if any. */
export function firstErrorIndex(
  questions: readonly Question[],
  errors: Record<string, unknown>,
): number | null {
  for (let i = 0; i < questions.length; i++) {
    if (errors[fieldOf(i)]) return i;
  }
  return null;
}
