import type { Question } from "@/domain/models/coachForms";
import { applyServerErrors } from "@/shared/form";
import {
  REQUIRED_PROBLEM,
  SERVER_PROBLEM,
  answerDefaults,
  answerForm,
  emptyAnswer,
  firstErrorIndex,
  hasPhotoAnswer,
  photosToUpload,
  prepareAnswer,
  type AnswerValues,
} from "../formAnswerForms";

const Q: Question[] = [
  { id: "energy", type: "scale", prompt: "Energy", required: true },
  {
    id: "weight",
    type: "number",
    prompt: "Weight",
    required: false,
    min: 30,
    max: 300,
    unit: "kg",
  },
  { id: "win", type: "short_text", prompt: "Biggest win", required: false },
  { id: "notes", type: "long_text", prompt: "Notes", required: false },
  {
    id: "mood",
    type: "single_choice",
    prompt: "Mood",
    required: false,
    options: ["Good", "Bad"],
  },
  {
    id: "days",
    type: "multiple_choice",
    prompt: "Days",
    required: false,
    options: ["Mon", "Tue", "Wed"],
  },
  {
    id: "pain",
    type: "yes_no",
    prompt: "Any pain?",
    required: true,
    detailsIfYes: true,
  },
  { id: "front", type: "photo", prompt: "Front", required: false },
];

async function check(values: AnswerValues) {
  const form = answerForm(Q);
  const result = await form.resolver(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  return result.errors as Record<string, { message?: string }>;
}

describe("defaults and preparing answers", () => {
  it("an empty answer per type, with a saved draft on top", () => {
    expect(Q.map(emptyAnswer)).toEqual([
      null,
      "",
      "",
      "",
      null,
      [],
      { value: null, details: "" },
      { uri: null, mediaId: null },
    ]);
    const d = answerDefaults(Q, { q0: 4, q99: "ignored" });
    expect(d.q0).toBe(4);
    expect(d.q1).toBe("");
    expect(d).not.toHaveProperty("q99");
  });

  it("prepares what the API takes, blanks as undefined", () => {
    expect(prepareAnswer(Q[1]!, " 82,4 ")).toBe(82.4);
    expect(prepareAnswer(Q[1]!, 80)).toBe(80);
    expect(prepareAnswer(Q[1]!, "abc")).toBe("abc");
    expect(prepareAnswer(Q[1]!, "")).toBeUndefined();
    expect(prepareAnswer(Q[2]!, "  hi ")).toBe("hi");
    expect(prepareAnswer(Q[2]!, "   ")).toBeUndefined();
    expect(prepareAnswer(Q[0]!, null)).toBeUndefined();
    expect(prepareAnswer(Q[4]!, "")).toBeUndefined();
    expect(prepareAnswer(Q[5]!, ["Wed", "Mon"])).toEqual(["Mon", "Wed"]);
    expect(prepareAnswer(Q[5]!, [])).toBeUndefined();
    expect(prepareAnswer(Q[6]!, { value: null, details: "" })).toBeUndefined();
    expect(prepareAnswer(Q[6]!, { value: false, details: "x" })).toBe(false);
    expect(prepareAnswer(Q[6]!, { value: true, details: " knee " })).toEqual({
      value: true,
      details: "knee",
    });
    expect(prepareAnswer(Q[6]!, { value: true, details: " " })).toBe(true);
    expect(prepareAnswer(Q[7]!, { uri: "file://a", mediaId: null })).toBe(
      "local",
    );
    expect(prepareAnswer(Q[7]!, { uri: "file://a", mediaId: "m" })).toEqual({
      mediaId: "m",
    });
    expect(prepareAnswer(Q[7]!, { uri: null, mediaId: null })).toBeUndefined();
    expect(prepareAnswer(Q[7]!, "nope")).toBeUndefined();
  });
});

describe("the schema", () => {
  it("required questions need an answer", async () => {
    const errors = await check(answerDefaults(Q));
    expect(errors.q0?.message).toBe(REQUIRED_PROBLEM);
    expect(errors.q6?.message).toBe(REQUIRED_PROBLEM);
    expect(errors.q1).toBeUndefined();
  });

  it("numbers: a number, inside the coach's range", async () => {
    const base = {
      ...answerDefaults(Q),
      q0: 3,
      q6: { value: false, details: "" },
    };
    expect((await check({ ...base, q1: "abc" })).q1?.message).toBe(
      "Enter a number.",
    );
    expect((await check({ ...base, q1: "20" })).q1?.message).toBe(
      "Enter 30 or more.",
    );
    expect((await check({ ...base, q1: "301" })).q1?.message).toBe(
      "Enter 300 or less.",
    );
    expect(await check({ ...base, q1: "82.4" })).toEqual({});
  });

  it("text and details limits", async () => {
    const base = {
      ...answerDefaults(Q),
      q0: 3,
      q6: { value: false, details: "" },
    };
    expect((await check({ ...base, q2: "x".repeat(501) })).q2?.message).toBe(
      "Keep this under 500 characters.",
    );
    expect((await check({ ...base, q3: "x".repeat(5001) })).q3?.message).toBe(
      "Keep this under 5,000 characters.",
    );
    expect(
      (await check({ ...base, q6: { value: true, details: "x".repeat(501) } }))
        .q6?.message,
    ).toBe("Keep the details under 500 characters.");
  });

  it("accepts one question at a time (for Next)", () => {
    const form = answerForm(Q);
    const v = answerDefaults(Q);
    expect(form.accepts(v, 0)).toBe(false); // required, blank
    expect(form.accepts({ ...v, q0: 4 }, 0)).toBe(true);
    expect(form.accepts(v, 1)).toBe(true); // optional, blank
    expect(form.accepts({ ...v, q1: "10" }, 1)).toBe(false);
    expect(form.accepts(v, 99)).toBe(true);
  });

  it("API answers by question id, uploaded photos only", () => {
    const form = answerForm(Q);
    const answers = form.toApiAnswers({
      ...answerDefaults(Q),
      q0: 4,
      q1: "82",
      q4: "Good",
      q6: { value: true, details: "knee" },
      q7: { uri: "file://a", mediaId: null },
    });
    expect(answers).toEqual({
      energy: 4,
      weight: 82,
      mood: "Good",
      pain: { value: true, details: "knee" },
    });
    expect(
      form.toApiAnswers({
        ...answerDefaults(Q),
        q7: { uri: "f", mediaId: "m" },
      }),
    ).toEqual({ front: { mediaId: "m" } });
  });

  it("a coach's question id of __proto__ stays an own key", () => {
    const form = answerForm([
      { id: "__proto__", type: "short_text", prompt: "x", required: true },
    ]);
    const out = form.toApiAnswers({ q0: "hello" });
    expect(Object.keys(out)).toEqual(["__proto__"]);
    expect(JSON.parse(JSON.stringify(out))).toEqual(
      JSON.parse('{"__proto__":"hello"}'),
    );
  });
});

describe("server errors (422 invalid_answers)", () => {
  it("land on the question named by id, in the form's words", () => {
    const form = answerForm(Q);
    const set: { field: string; message?: string }[] = [];
    const setError = ((field: string, e: { message?: string }) =>
      set.push({ field, message: e.message })) as never;
    const mapped = applyServerErrors(
      {
        status: 422,
        json: {
          code: "invalid_answers",
          errors: [
            { at: "weight", message: "must be at most 300" },
            { at: "constructor", message: "unknown question" },
          ],
        },
      },
      setError,
      form.serverMap,
    );
    expect(mapped).toBe(true);
    expect(set).toEqual([{ field: "q1", message: SERVER_PROBLEM }]);
  });

  it("first question with an error", () => {
    expect(firstErrorIndex(Q, { q3: {}, q1: {} })).toBe(1);
    expect(firstErrorIndex(Q, {})).toBeNull();
  });
});

describe("photos", () => {
  it("lists photos still to upload", () => {
    const v = {
      ...answerDefaults(Q),
      q7: { uri: "file://a", mediaId: null },
    };
    expect(photosToUpload(Q, v)).toEqual([{ index: 7, uri: "file://a" }]);
    expect(hasPhotoAnswer(Q, v)).toBe(true);
    const uploaded = { ...v, q7: { uri: "file://a", mediaId: "m" } };
    expect(photosToUpload(Q, uploaded)).toEqual([]);
    expect(hasPhotoAnswer(Q, uploaded)).toBe(true);
    expect(hasPhotoAnswer(Q, answerDefaults(Q))).toBe(false);
  });
});
