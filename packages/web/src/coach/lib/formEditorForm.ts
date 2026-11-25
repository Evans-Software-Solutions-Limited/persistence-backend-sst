import { Type } from "@sinclair/typebox";
import { ValueErrorType } from "@sinclair/typebox/errors";
import type { FieldErrors } from "react-hook-form";
import { schemaResolver, type ServerFieldMap } from "@/lib/form";
import type { FormQuestion } from "../api/types";
import {
  MAX_HELP,
  MAX_OPTIONS,
  MAX_PROMPT,
  MAX_QUESTIONS,
  MAX_TITLE,
  cleanQuestions,
} from "./forms";

/**
 * The form editor (C10b) as a react-hook-form (PER-147). The schema says
 * what the API's `validateQuestions` would refuse, in the editor's words, and
 * is checked on trimmed questions as the server checks them. Problems show
 * under each question while the coach types; Save stays off until there are
 * none, the form has a name and at least one question.
 */

export interface FormEditorValues {
  title: string;
  questions: FormQuestion[];
}

const OPTIONS_COUNT = `Give 2 to ${MAX_OPTIONS} options.`;
export const RANGE_MESSAGE = "The lowest number must not be above the highest.";
export const UNIQUE_MESSAGE = "Options must be different.";

const questionSchema = Type.Object({
  id: Type.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" }),
  type: Type.String(),
  prompt: Type.String({
    minLength: 1,
    maxLength: MAX_PROMPT,
    errorMessage: {
      StringMinLength: "Write the question.",
      StringMaxLength: `Keep the question under ${MAX_PROMPT} characters.`,
    },
  }),
  help: Type.Optional(
    Type.String({
      maxLength: MAX_HELP,
      errorMessage: `Keep the help text under ${MAX_HELP} characters.`,
    }),
  ),
  options: Type.Optional(
    Type.Array(
      Type.String({ minLength: 1, errorMessage: "Fill in every option." }),
      {
        minItems: 2,
        maxItems: MAX_OPTIONS,
        errorMessage: {
          ArrayMinItems: OPTIONS_COUNT,
          ArrayMaxItems: OPTIONS_COUNT,
        },
      },
    ),
  ),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
});

export const formEditorSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: MAX_TITLE }),
  questions: Type.Array(questionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
  }),
});

export const formEditorResolver = schemaResolver<FormEditorValues>(
  formEditorSchema,
  {
    prepare: (v: FormEditorValues) => ({
      title: v.title.trim(),
      questions: cleanQuestions(v.questions),
    }),
    refine: (v: FormEditorValues) => {
      const out: Record<string, string> = {};
      v.questions.forEach((q, i) => {
        // Repeated options are checked here, not with `uniqueItems`: in the
        // app react-hook-form passes `names: []`, so a schema error on the
        // list would replace the per-option "Fill in every option." errors.
        // A blank option is named first, so repeats only count without one.
        const opts = q.options ?? [];
        if (
          opts.length > 0 &&
          opts.every((o) => o !== "") &&
          new Set(opts).size !== opts.length
        ) {
          out[`questions.${i}.options`] = UNIQUE_MESSAGE;
        }
        if (
          q.type === "number" &&
          q.min !== undefined &&
          q.max !== undefined &&
          q.min > q.max
        ) {
          out[`questions.${i}.max`] = RANGE_MESSAGE;
        }
      });
      return out;
    },
  },
);

type Leaf = { message?: string; type?: string } | undefined;
type Node = Leaf & Record<string, unknown>;

const COUNT_TYPES = new Set([
  String(ValueErrorType.ArrayMinItems),
  String(ValueErrorType.ArrayMaxItems),
]);

/** An options error: its count first, then a blank option, then repeats. */
function optionsProblem(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const root = (node.root as Leaf) ?? (node.message ? node : undefined);
  if (root?.message && COUNT_TYPES.has(String(root.type))) return root.message;
  const blank = Object.entries(node).find(
    ([k, v]) => /^\d+$/.test(k) && (v as Leaf)?.message,
  );
  if (blank) return (blank[1] as Leaf)!.message;
  return root?.message;
}

/** One message per question, in the order the editor always showed them. */
export function problemsFrom(
  errors: FieldErrors<FormEditorValues>,
): Map<number, string> {
  const out = new Map<number, string>();
  const list = errors.questions as unknown as
    | Record<string, Node | undefined>
    | undefined;
  if (!list || typeof list !== "object") return out;
  for (const [key, q] of Object.entries(list)) {
    if (!/^\d+$/.test(key) || !q) continue;
    const message =
      (q.prompt as Leaf)?.message ??
      (q.help as Leaf)?.message ??
      optionsProblem(q.options as Node | undefined) ??
      (q.max as Leaf)?.message ??
      q.message;
    if (message) out.set(Number(key), message);
  }
  return out;
}

/** Where a 422 lands: `invalid_questions` names each question by index. */
export const FORM_SERVER_FIELDS: ServerFieldMap<FormEditorValues> = {
  questions: {
    field: "questions.{n}.prompt",
    message: "Check this question and try again.",
  },
};
