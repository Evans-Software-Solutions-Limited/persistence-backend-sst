import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { readPreviousValues } from "../previousValues";
import type { TogetherExecution, TogetherPlan } from "../types";

/**
 * Drives `readPreviousValues` through the REAL `drizzle-orm/postgres-js`
 * driver with a stub client that records what reaches the wire. That driver
 * replaces postgres.js's timestamp serializers with identity functions (it
 * expects Drizzle's column mappers to have already produced strings), so a raw
 * JS `Date` bound against a `sql` fragment reaches postgres.js unserialised
 * and throws `The "string" argument must be of type string… Received an
 * instance of Date` (Sentry PERSISTENCE-BACKEND-7, 16 Oct 2026). The PGlite
 * integration suite cannot catch this because that driver serialises Dates
 * itself.
 */
function stubClient() {
  const calls: { query: string; params: unknown[] }[] = [];
  const unsafe = (query: string, params: unknown[]) => {
    calls.push({ query, params });
    const result = Promise.resolve([]) as Promise<never[]> & {
      values: () => Promise<never[]>;
    };
    result.values = () => Promise.resolve([]);
    return result;
  };
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe,
  };
  return { client, calls };
}

const plan: TogetherPlan = {
  exercises: [
    { planExerciseId: "p1", exerciseId: "e1", name: "Bench", sets: 3 },
    { planExerciseId: "p2", exerciseId: "e2", name: "Row", sets: 3 },
  ],
} as unknown as TogetherPlan;
const execution: TogetherExecution = {
  exercises: [{ planExerciseId: "p2", skipped: true }],
} as unknown as TogetherExecution;

describe("readPreviousValues at the postgres-js driver boundary", () => {
  it("binds the recorded-at bound as a string, never a Date instance", async () => {
    const { client, calls } = stubClient();
    // The stub only needs the surface the driver touches; `never` skips the
    // overload union without pretending it is a full postgres.js client.
    const db = drizzle(client as never);
    const before = new Date("2026-10-16T09:00:00.000Z");
    await expect(
      readPreviousValues(
        db as unknown as Parameters<typeof readPreviousValues>[0],
        "11111111-1111-4111-8111-111111111111",
        plan,
        execution,
        before,
      ),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
    const { query, params } = calls[0];
    expect(query).toContain("coalesce(");
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(before.toISOString());
    // Only the un-skipped exercise is queried.
    expect(params).toContain("e1");
    expect(params).not.toContain("e2");
  });
});
