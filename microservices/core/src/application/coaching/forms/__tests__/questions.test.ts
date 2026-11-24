import { describe, expect, it } from "vitest";
import {
  MAX_QUESTIONS,
  validateAnswers,
  validateQuestions,
  type Question,
} from "../questions";

const q = (extra: Record<string, unknown>) => ({
  id: "q",
  type: "short_text",
  prompt: "Prompt",
  ...extra,
});

function firstError(raw: unknown): string {
  const res = validateQuestions([raw]);
  if (res.ok) throw new Error("expected a failure");
  return res.errors[0]!.message;
}

describe("validateQuestions", () => {
  it("accepts every type and normalises text", () => {
    const res = validateQuestions([
      q({ id: "a", prompt: "  Name\u0000 ", required: true }),
      q({ id: "b", type: "long_text" }),
      q({ id: "c", type: "number", min: 1, max: 5, unit: " kg " }),
      q({ id: "d", type: "scale" }),
      q({ id: "e", type: "single_choice", options: [" Yes ", "No"] }),
      q({ id: "f", type: "multiple_choice", options: ["A", "B", "C"] }),
      q({ id: "g", type: "photo" }),
      q({ id: "h", type: "yes_no", required: false }),
      q({ id: "i", type: "number" }),
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value[0]).toEqual({
      id: "a",
      type: "short_text",
      prompt: "Name",
      required: true,
    });
    expect(res.value[2]).toMatchObject({ min: 1, max: 5, unit: "kg" });
    expect(res.value[4]!.options).toEqual(["Yes", "No"]);
    expect(res.value[7]!.required).toBe(false);
  });

  it("rejects the list shape", () => {
    expect(validateQuestions("x").ok).toBe(false);
    expect(validateQuestions([]).ok).toBe(false);
    expect(
      validateQuestions(
        Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => q({ id: `q${i}` })),
      ).ok,
    ).toBe(false);
    const dup = validateQuestions([q({}), q({})]);
    expect(!dup.ok && dup.errors[0]!.message).toMatch(/duplicate/);
  });

  it.each([
    ["not an object", "x", /object/],
    ["unknown field", q({ colour: "red" }), /unknown field/],
    ["bad id", q({ id: "has space" }), /id must be/],
    ["bad type", q({ type: "video" }), /type must be/],
    ["empty prompt", q({ prompt: " " }), /prompt/],
    ["long prompt", q({ prompt: "x".repeat(301) }), /prompt/],
    ["required type", q({ required: "yes" }), /required/],
    ["choice without options", q({ type: "single_choice" }), /required/],
    [
      "too few options",
      q({ type: "single_choice", options: ["one"] }),
      /entries/,
    ],
    [
      "blank option",
      q({ type: "multiple_choice", options: ["a", " "] }),
      /each option/,
    ],
    [
      "duplicate option",
      q({ type: "multiple_choice", options: ["a", "a"] }),
      /unique/,
    ],
    ["options on text", q({ options: ["a", "b"] }), /only choice/],
    ["min type", q({ type: "number", min: "1" }), /min must/],
    ["max type", q({ type: "number", max: Infinity }), /max must/],
    ["min above max", q({ type: "number", min: 5, max: 1 }), /not be above/],
    ["blank unit", q({ type: "number", unit: " " }), /unit/],
    ["unit on text", q({ unit: "kg" }), /only number/],
    ["min on scale", q({ type: "scale", min: 0 }), /only number/],
  ])("rejects %s", (_name, raw, message) => {
    expect(firstError(raw)).toMatch(message);
  });
});

const QUESTIONS: Question[] = [
  { id: "t", type: "short_text", prompt: "T", required: true },
  { id: "l", type: "long_text", prompt: "L", required: false },
  { id: "n", type: "number", prompt: "N", required: false, min: 0, max: 10 },
  { id: "s", type: "scale", prompt: "S", required: false },
  {
    id: "m",
    type: "multiple_choice",
    prompt: "M",
    required: true,
    options: ["a", "b"],
  },
];

describe("validateAnswers", () => {
  it("leaves out blank optional answers and keeps option order", () => {
    const res = validateAnswers(QUESTIONS, {
      t: " hi ",
      l: "",
      n: null,
      m: ["b", "a"],
    });
    expect(res).toEqual({ ok: true, value: { t: "hi", m: ["a", "b"] } });
  });

  it("a required text that is only NULs and spaces counts as missing", () => {
    const res = validateAnswers(QUESTIONS, { t: "\u0000 ", m: ["a"] });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.errors).toEqual([{ at: "t", message: "required" }]);
  });

  it("reports each bad answer", () => {
    const res = validateAnswers(QUESTIONS, {
      t: "x".repeat(501),
      n: 11,
      s: 2.5,
      m: "a",
    });
    expect(!res.ok && res.errors.map((e) => e.at)).toEqual([
      "t",
      "n",
      "s",
      "m",
    ]);
    const low = validateAnswers(QUESTIONS, { t: "x", m: ["a"], n: -1 });
    expect(!low.ok && low.errors[0]!.message).toMatch(/at least 0/);
    const nan = validateAnswers(QUESTIONS, { t: "x", m: ["a"], n: "3" });
    expect(!nan.ok && nan.errors[0]!.message).toMatch(/a number/);
    const missing = validateAnswers(QUESTIONS, { t: "x", m: [] });
    expect(!missing.ok && missing.errors).toEqual([
      { at: "m", message: "required" },
    ]);
  });

  it("rejects a non-object", () => {
    expect(validateAnswers(QUESTIONS, ["t"]).ok).toBe(false);
    expect(validateAnswers(QUESTIONS, null).ok).toBe(false);
  });
});

describe("Inspector Brad sweep 1 (PR #543)", () => {
  it("an optional question whose id names an Object.prototype member can be skipped", () => {
    const questions: Question[] = [
      { id: "constructor", type: "short_text", prompt: "A", required: false },
      { id: "toString", type: "yes_no", prompt: "B", required: false },
      { id: "valueOf", type: "number", prompt: "C", required: true },
    ];
    expect(validateAnswers(questions, { valueOf: 3 })).toEqual({
      ok: true,
      value: { valueOf: 3 },
    });
    const missing = validateAnswers(questions, {});
    expect(!missing.ok && missing.errors).toEqual([
      { at: "valueOf", message: "required" },
    ]);
  });
});

describe("Inspector Brad sweep 2 (PR #543)", () => {
  it("a question id of __proto__ keeps the athlete's answer", () => {
    const questions: Question[] = [
      { id: "__proto__", type: "short_text", prompt: "A", required: true },
      {
        id: "q2",
        type: "multiple_choice",
        prompt: "B",
        required: false,
        options: ["x", "y"],
      },
    ];
    const raw = JSON.parse('{"__proto__": "hello", "q2": ["y"]}');
    const res = validateAnswers(questions, raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.hasOwn(res.value, "__proto__")).toBe(true);
    expect(JSON.parse(JSON.stringify(res.value))).toEqual(
      JSON.parse('{"__proto__": "hello", "q2": ["y"]}'),
    );
    expect(Object.getPrototypeOf(res.value)).toBe(Object.prototype);
  });
});

// PER-129 (C10b): help text, details if yes, filled for them.
describe("C10b question extras", () => {
  it("keeps help, detailsIfYes and prefill", () => {
    const res = validateQuestions([
      q({ id: "a", help: "  Where is it?  " }),
      q({ id: "b", type: "yes_no", detailsIfYes: true }),
      q({ id: "c", type: "number", unit: "kg", prefill: "weight" }),
      q({ id: "d", type: "photo", prefill: "progress_photos" }),
      q({ id: "e", help: "  ", detailsIfYes: false, prefill: null }),
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value[0]!.help).toBe("Where is it?");
    expect(res.value[1]!.detailsIfYes).toBe(true);
    expect(res.value[2]!.prefill).toBe("weight");
    expect(res.value[3]!.prefill).toBe("progress_photos");
    // Blank help and a false flag are dropped, not stored.
    expect(res.value[4]).toEqual({
      id: "e",
      type: "short_text",
      prompt: "Prompt",
      required: false,
    });
  });

  it.each([
    ["help not text", q({ help: 3 }), /help must be text/],
    ["long help", q({ help: "x".repeat(301) }), /help must be at most/],
    ["details flag type", q({ detailsIfYes: "yes" }), /boolean/],
    ["details on text", q({ detailsIfYes: true }), /only yes\/no/],
    ["unknown prefill", q({ prefill: "mood" }), /prefill must be one of/],
    ["prefill not a string", q({ prefill: 1 }), /prefill must be one of/],
    ["prefill on proto key", q({ prefill: "constructor" }), /prefill must/],
    ["prefill wrong type", q({ prefill: "weight" }), /needs a number/],
  ])("rejects %s", (_name, raw, message) => {
    expect(firstError(raw)).toMatch(message);
  });

  const yes: Question = {
    id: "pain",
    type: "yes_no",
    prompt: "Any pain?",
    required: true,
    detailsIfYes: true,
  };

  it("takes details with a yes and drops them with a no", () => {
    const withDetails = validateAnswers([yes], {
      pain: { value: true, details: "  Left knee  " },
    });
    expect(withDetails).toEqual({
      ok: true,
      value: { pain: { value: true, details: "Left knee" } },
    });
    expect(
      validateAnswers([yes], { pain: { value: false, details: "x" } }),
    ).toEqual({ ok: true, value: { pain: false } });
    expect(validateAnswers([yes], { pain: { value: true } })).toEqual({
      ok: true,
      value: { pain: true },
    });
    expect(validateAnswers([yes], { pain: true })).toEqual({
      ok: true,
      value: { pain: true },
    });
  });

  it.each([
    ["extra key", { value: true, colour: "red" }],
    ["details not text", { value: true, details: 4 }],
    ["long details", { value: true, details: "x".repeat(501) }],
    ["no value", { details: "x" }],
  ])("rejects a details answer with %s", (_name, answer) => {
    expect(validateAnswers([yes], { pain: answer }).ok).toBe(false);
  });

  it("only details-if-yes questions take the object form", () => {
    const plain: Question = { ...yes, detailsIfYes: undefined };
    expect(validateAnswers([plain], { pain: { value: true } }).ok).toBe(false);
  });
});
