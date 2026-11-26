import { Type } from "@sinclair/typebox";
import { ValueErrorType } from "@sinclair/typebox/errors";
import type { FieldErrors } from "react-hook-form";
import { schemaResolver, trimmed } from "@/shared/form";
import {
  MAX_HELP,
  MAX_OPTIONS,
  MAX_PROMPT,
  MAX_QUESTIONS,
  MAX_UNIT,
  MIN_OPTIONS,
  REPLY_MAX,
  TITLE_MAX,
  type Question,
} from "@/domain/models/coachForms";
import { cleanQuestion } from "@/domain/services/coachForms.service";

/**
 * The coach form editor (C10b, PER-147) as a react-hook-form. The schema is
 * what the API's `validateQuestions` refuses, checked on trimmed questions;
 * the editor shows the first problem in the coach's words, the same lines
 * and order as before. `{n}` is the question's number.
 *
 * This is also the pattern for any mobile form (PER-130 builds on it):
 *   1. a TypeBox schema with the copy in `errorMessage`;
 *   2. `schemaResolver(schema, { prepare, refine })` from `@/shared/form`;
 *   3. `useForm({ resolver })` in the container; `handleSubmit` to save;
 *   4. `applyServerErrors(error, setError, MAP)` for a submit the server
 *      answers straight away. (A form saved through the offline queue, like
 *      this one, hears back later: its 409 comes through the queue's
 *      conflict state, unchanged.)
 */

export interface FormEditorValues {
  title: string;
  description: string;
  questions: Question[];
}

const N = "{n}";

const questionSchema = Type.Object({
  prompt: Type.String({
    minLength: 1,
    maxLength: MAX_PROMPT,
    errorMessage: {
      StringMinLength: `Question ${N} needs a question.`,
      StringMaxLength: `Question ${N} is over ${MAX_PROMPT} characters.`,
    },
  }),
  help: Type.Optional(
    Type.String({
      maxLength: MAX_HELP,
      errorMessage: `Question ${N}'s help text is over ${MAX_HELP} characters.`,
    }),
  ),
  options: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
        errorMessage: `Question ${N} has an empty option.`,
      }),
      {
        minItems: MIN_OPTIONS,
        maxItems: MAX_OPTIONS,
        errorMessage: {
          ArrayMinItems: `Question ${N} needs ${MIN_OPTIONS}–${MAX_OPTIONS} options.`,
          ArrayMaxItems: `Question ${N} needs ${MIN_OPTIONS}–${MAX_OPTIONS} options.`,
        },
      },
    ),
  ),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  unit: Type.Optional(
    Type.String({
      maxLength: MAX_UNIT,
      errorMessage: `Question ${N}'s unit is over ${MAX_UNIT} characters.`,
    }),
  ),
});

export const formEditorSchema = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: TITLE_MAX,
    errorMessage: {
      StringMinLength: "Give the form a title.",
      StringMaxLength: `Keep the title to ${TITLE_MAX} characters.`,
    },
  }),
  questions: Type.Array(questionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
    errorMessage: {
      ArrayMinItems: "Add at least one question.",
      ArrayMaxItems: `A form can have up to ${MAX_QUESTIONS} questions.`,
    },
  }),
});

export const RANGE_PROBLEM = `Question ${N}: the lowest value is above the highest.`;
export const REPEAT_PROBLEM = `Question ${N} has the same option twice.`;

export function prepareFormEditor(v: FormEditorValues) {
  return {
    title: v.title.trim(),
    questions: v.questions.map(cleanQuestion),
  };
}

export const formEditorResolver = schemaResolver<FormEditorValues>(
  formEditorSchema,
  {
    prepare: prepareFormEditor,
    refine: (v: ReturnType<typeof prepareFormEditor>) => {
      const out: Record<string, string> = {};
      v.questions.forEach((q, i) => {
        // Repeated options are checked here, not with `uniqueItems`: in the
        // app react-hook-form passes `names: []`, so a schema error on the
        // list would replace the per-option "has an empty option" errors.
        // A blank option is named first, so repeats only count without one
        // (Inspector Brad, #561).
        const opts = q.options ?? [];
        if (
          opts.length > 0 &&
          opts.every((o) => o !== "") &&
          new Set(opts).size !== opts.length
        ) {
          out[`questions.${i}.options`] = REPEAT_PROBLEM;
        }
        if (q.min !== undefined && q.max !== undefined && q.min > q.max) {
          out[`questions.${i}.max`] = RANGE_PROBLEM;
        }
      });
      return out;
    },
  },
);

type Leaf = { message?: string; type?: string } | undefined;
type Node = Record<string, unknown> & { message?: string; type?: string };

const COUNT = new Set([
  String(ValueErrorType.ArrayMinItems),
  String(ValueErrorType.ArrayMaxItems),
]);

function optionsProblem(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const root = (node.root as Leaf) ?? (node.message ? node : undefined);
  if (root?.message && COUNT.has(String(root.type))) return root.message;
  const blank = Object.entries(node).find(
    ([k, v]) => /^\d+$/.test(k) && (v as Leaf)?.message,
  );
  return (blank?.[1] as Leaf)?.message ?? root?.message;
}

// ─── Reply to a check-in (C3.3) ──────────────────────────────────────────────

export interface ReplyValues {
  reply: string;
}

/** The API takes up to 2,000 characters (`REPLY_MAX`, shared). */
export const replySchema = Type.Object({
  reply: Type.String({
    minLength: 1,
    maxLength: REPLY_MAX,
    errorMessage: {
      StringMinLength: "Write a reply.",
      StringMaxLength: "Keep the reply under 2,000 characters.",
    },
  }),
});

export const replyResolver = schemaResolver<ReplyValues>(replySchema, {
  prepare: trimmed,
});

/** The first problem, in the order the editor always checked. */
export function firstFormProblem(
  errors: FieldErrors<FormEditorValues>,
): string | null {
  const title = (errors.title as Leaf)?.message;
  if (title) return title;
  const list = errors.questions as unknown as Node | undefined;
  if (!list) return null;
  const count = (list.root as Leaf)?.message ?? list.message;
  if (count) return count;
  const indexes = Object.keys(list)
    .filter((k) => /^\d+$/.test(k))
    .map(Number)
    .sort((a, b) => a - b);
  for (const i of indexes) {
    const q = list[String(i)] as Node | undefined;
    if (!q) continue;
    const message =
      (q.prompt as Leaf)?.message ??
      (q.help as Leaf)?.message ??
      optionsProblem(q.options as Node | undefined) ??
      (q.max as Leaf)?.message ??
      (q.unit as Leaf)?.message ??
      q.message;
    if (message) return message.replace(N, String(i + 1));
  }
  return null;
}
