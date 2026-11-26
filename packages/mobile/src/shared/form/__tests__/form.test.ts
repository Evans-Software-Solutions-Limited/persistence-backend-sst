import { Type } from "@sinclair/typebox";
import {
  SetErrorFunction,
  DefaultErrorFunction,
} from "@sinclair/typebox/errors";

import {
  applyServerErrors,
  applyValues,
  fieldMessages,
  firstMessage,
  installFormMessages,
  messageAt,
  schemaAccepts,
  schemaResolver,
  serverFieldIssues,
  trimmed,
} from "..";

// As react-hook-form calls it in the app: nothing registered, so `names` is
// empty (Inspector Brad, #561).
const opts = {
  fields: {},
  names: [] as never[],
  shouldUseNativeValidation: false,
};

describe("schemaResolver (PER-147)", () => {
  const schema = Type.Object({
    name: Type.String({ minLength: 1, errorMessage: "Add a name." }),
    tags: Type.Array(Type.String(), {
      maxItems: 1,
      errorMessage: { ArrayMaxItems: "One tag." },
    }),
    count: Type.Integer({ minimum: 0 }),
  });

  it("uses the schema's copy, per failure kind or one for all", async () => {
    const r = schemaResolver<{ name: string; tags: string[]; count: number }>(
      schema,
    );
    const bad = await r(
      { name: "", tags: ["a", "b"], count: -1 },
      undefined,
      opts,
    );
    expect(messageAt(bad.errors, "name")).toBe("Add a name.");
    expect(messageAt(bad.errors, "tags")).toBe("One tag.");
    // No custom copy: TypeBox's own message.
    expect(messageAt(bad.errors, "count")).toMatch(/greater or equal/);
    expect(bad.values).toEqual({});
  });

  it("checks prepared values but submits the raw ones", async () => {
    const r = schemaResolver<{ name: string; tags: string[]; count: number }>(
      schema,
      { prepare: trimmed },
    );
    expect(
      messageAt(
        (await r({ name: "  ", tags: [], count: 0 }, undefined, opts)).errors,
        "name",
      ),
    ).toBe("Add a name.");
    const ok = await r({ name: " Lena ", tags: [], count: 0 }, undefined, opts);
    expect(ok).toEqual({
      values: { name: " Lena ", tags: [], count: 0 },
      errors: {},
    });
  });

  it("adds cross-field rules next to the schema's, never over them", async () => {
    const r = schemaResolver<{ name: string; tags: string[]; count: number }>(
      schema,
      {
        refine: () => ({
          name: "never shown",
          "rows.1.max": "Too low.",
          count: undefined,
        }),
      },
    );
    const res = await r({ name: "", tags: [], count: 0 }, undefined, opts);
    expect(messageAt(res.errors, "name")).toBe("Add a name.");
    expect(messageAt(res.errors, "rows.1.max")).toBe("Too low.");
    expect(Array.isArray((res.errors as Record<string, unknown>).rows)).toBe(
      true,
    );
    expect(messageAt(res.errors, "count")).toBeUndefined();
  });

  it("re-installs the message function if something replaced it", async () => {
    SetErrorFunction(DefaultErrorFunction);
    installFormMessages();
    installFormMessages();
    const r = schemaResolver(schema);
    const res = await r({ name: "", tags: [], count: 0 }, undefined, opts);
    expect(messageAt(res.errors, "name")).toBe("Add a name.");
  });
});

describe("error lookups", () => {
  it("messageAt, firstMessage and fieldMessages read nested errors", () => {
    const errors = {
      a: { message: "A" },
      list: [undefined, { b: { message: "B", ref: { message: "no" } } }],
      empty: { message: "" },
    };
    expect(messageAt(errors, "a")).toBe("A");
    expect(messageAt(errors, "list.1.b")).toBe("B");
    expect(messageAt(errors, "a.x.y")).toBeUndefined();
    expect(messageAt(errors, "empty")).toBeUndefined();
    expect(firstMessage({ list: errors.list })).toBe("B");
    expect(
      firstMessage({ ref: { message: "x" }, types: { message: "y" } }),
    ).toBeUndefined();
    expect(firstMessage(null)).toBeUndefined();
    expect(fieldMessages(errors as never, ["a", "empty"] as never)).toEqual({
      a: "A",
    });
  });
});

describe("applyValues", () => {
  it("writes only what changed", () => {
    const setValue = jest.fn();
    applyValues(
      { getValues: () => ({ a: "1", b: "2" }), setValue } as never,
      { a: "1", b: "3" },
      { validate: true },
    );
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenCalledWith("b", "3", {
      shouldDirty: true,
      shouldValidate: true,
    });
  });
});

describe("server errors", () => {
  const err = (status: number, body: unknown) => ({ status, body });

  it("reads Elysia's validation list, errors[].at, a field and words", () => {
    expect(
      serverFieldIssues(
        err(422, {
          validation: [
            { path: "/displayName", message: "too long" },
            { path: "/a~1b", summary: "s" },
            { path: "/c" },
            { nope: true },
          ],
          errors: [
            { at: 2, message: "bad" },
            { at: -1, message: "whole list" },
            { at: "", message: "x" },
            { at: "q1" },
            { at: null },
          ],
          field: "/goal",
          message: "m",
        }),
        { errorsAt: "questions" },
      ),
    ).toEqual([
      { path: "displayName", message: "too long" },
      { path: "a/b", message: "s" },
      { path: "c", message: "Check this." },
      { path: "questions.2", message: "bad" },
      { path: "questions.q1", message: "" },
      { path: "goal", message: "m" },
    ]);
    expect(
      serverFieldIssues(err(422, { errors: [{ at: 1, message: "x" }] })),
    ).toEqual([{ path: "1", message: "x" }]);
    expect(
      serverFieldIssues(err(422, { message: "timeLocal must be HH:MM" }), {
        fieldsInMessage: ["weekday", "timeLocal"],
      }),
    ).toEqual([{ path: "timeLocal", message: "timeLocal must be HH:MM" }]);
    expect(
      serverFieldIssues(err(422, { message: "nothing named" }), {
        fieldsInMessage: ["weekday"],
      }),
    ).toEqual([]);
  });

  it("ignores what isn't a field refusal", () => {
    expect(serverFieldIssues(null)).toEqual([]);
    expect(serverFieldIssues("x")).toEqual([]);
    expect(serverFieldIssues(err(500, { field: "a" }))).toEqual([]);
    expect(serverFieldIssues(err(422, null))).toEqual([]);
    expect(serverFieldIssues({ status: "422", body: {} })).toEqual([]);
  });

  it("puts each on the mapped field, by the longest prefix, once", () => {
    const setError = jest.fn();
    const mapped = applyServerErrors(
      err(422, {
        validation: [
          { path: "/questions/2/prompt", message: "x" },
          { path: "/questions/2/help", message: "y" },
          { path: "/contactEmail", message: "z" },
          { path: "/other", message: "w" },
        ],
      }),
      setError,
      {
        questions: { field: "questions.{n}.prompt", message: "Check it." },
        contactEmail: { field: "contact" },
      } as never,
    );
    expect(mapped).toBe(true);
    expect(setError.mock.calls).toEqual([
      ["questions.2.prompt", { type: "server", message: "Check it." }],
      ["contact", { type: "server", message: "z" }],
    ]);
    expect(applyServerErrors(err(422, {}), setError, {})).toBe(false);
  });

  it("an error about the whole list isn't put on a `{n}` field (Inspector Brad, #566)", () => {
    const setError = jest.fn();
    const map = {
      questions: { field: "questions.{n}.prompt", message: "Check it." },
    } as never;
    // "/questions" (e.g. "1–40 questions") names no question.
    expect(
      applyServerErrors(
        err(422, { validation: [{ path: "/questions", message: "x" }] }),
        setError,
        map,
      ),
    ).toBe(false);
    // Nor does a key that isn't an index.
    expect(
      applyServerErrors(
        err(422, { validation: [{ path: "/questions/abc", message: "x" }] }),
        setError,
        map,
      ),
    ).toBe(false);
    expect(setError).not.toHaveBeenCalled();
    // With an index it still lands on that question.
    expect(
      applyServerErrors(
        err(422, { errors: [{ at: 0, message: "x" }] }),
        setError,
        map,
        { errorsAt: "questions" },
      ),
    ).toBe(true);
    expect(setError).toHaveBeenCalledWith("questions.0.prompt", {
      type: "server",
      message: "Check it.",
    });
  });

  it("reads the mobile adapter's raw response ({ status, json })", () => {
    expect(
      serverFieldIssues({
        status: 422,
        json: { validation: [{ path: "/code", message: "bad" }] },
      }),
    ).toEqual([{ path: "code", message: "bad" }]);
    // The adapter's ApiError has no body: no field.
    expect(
      serverFieldIssues({ kind: "api", status: 422, message: "x" }),
    ).toEqual([]);
  });
});

describe("mobile extras", () => {
  const schema = Type.Object({ n: Type.Integer({ minimum: 1 }) });

  it("schemaAccepts checks the schema and the cross-field rules", () => {
    expect(schemaAccepts(schema, { n: 1 })).toBe(true);
    expect(schemaAccepts(schema, { n: 0 })).toBe(false);
    expect(schemaAccepts(schema, { n: 1 }, () => ({ n: "No." }))).toBe(false);
    expect(schemaAccepts(schema, { n: 1 }, () => ({ n: undefined }))).toBe(
      true,
    );
  });

  it("prepare sees react-hook-form's context", async () => {
    const r = schemaResolver<{ x: string }>(schema, {
      prepare: (_v, context) => ({ n: (context as { n: number }).n }),
    });
    expect((await r({ x: "" }, { n: 2 }, opts)).errors).toEqual({});
    expect(Object.keys((await r({ x: "" }, { n: 0 }, opts)).errors)).toEqual([
      "n",
    ]);
  });
});
