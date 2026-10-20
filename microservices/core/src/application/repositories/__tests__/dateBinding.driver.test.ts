import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { getDb } from "@persistence/db/client";
import { SessionRepository } from "../sessionRepository";
import { AiJobRepository } from "../../jobs/aiJobRepository";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

/**
 * Drives the queries that bind a time bound inside a `sql` template through
 * the REAL `drizzle-orm/postgres-js` driver with a stub client that records
 * what reaches the wire. That driver replaces postgres.js's timestamp
 * serializers with identity functions and relies on Drizzle's column mappers
 * to have produced strings; a template parameter has no column mapper, so a
 * raw `Date` reaches `Buffer.byteLength` and throws
 * `The "string" argument must be of type string… Received an instance of Date`
 * (Sentry PERSISTENCE-BACKEND-6, 35 events 7–19 Oct 2026, and BACKEND-7).
 * The PGlite suites cannot catch this because that driver serialises Dates.
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
  return {
    client: { options: { parsers: {}, serializers: {} }, unsafe },
    calls,
  };
}

describe("time bounds bound inside sql templates reach postgres-js as strings", () => {
  let calls: { query: string; params: unknown[] }[];
  beforeEach(() => {
    const stub = stubClient();
    calls = stub.calls;
    vi.mocked(getDb).mockReturnValue(
      drizzle(stub.client as never) as unknown as ReturnType<typeof getDb>,
    );
  });

  it("SessionRepository.getRecentSets binds `before` as an ISO string, never a Date", async () => {
    const before = new Date("2026-10-19T12:41:25.000Z");
    const rows = await new SessionRepository().getRecentSets(
      "11111111-1111-4111-8111-111111111111",
      { exerciseIds: ["e1", "e2"], before },
    );
    expect(rows).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("coalesce(");
    expect(calls[0].params.some((p) => p instanceof Date)).toBe(false);
    expect(calls[0].params).toContain(before.toISOString());
  });

  it("SessionRepository.getRecentSets without filters binds no time bound at all", async () => {
    await new SessionRepository().getRecentSets(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].params.some((p) => p instanceof Date)).toBe(false);
    expect(calls[0].query).not.toContain(
      'coalesce("workout_sessions"."completed_at", "workout_sessions"."started_at") <',
    );
  });

  it("AiJobRepository.claim binds the claim fence as an ISO string", async () => {
    const before = Date.now();
    const claimed = await new AiJobRepository().claim("j1");
    expect(claimed).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("heartbeat_at");
    expect(calls[0].params.some((p) => p instanceof Date)).toBe(false);
    const iso = calls[0].params.find(
      (p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(p),
    ) as string;
    expect(new Date(iso).getTime()).toBeLessThan(before);
  });

  it("AiJobRepository.failIfStale binds both staleness cutoffs as ISO strings", async () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    const failed = await new AiJobRepository().failIfStale(
      "j1",
      { code: "stale", message: "stale", retryable: false },
      now,
    );
    expect(failed).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].params.some((p) => p instanceof Date)).toBe(false);
    const isos = calls[0].params.filter(
      (p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(p),
    ) as string[];
    expect(isos).toHaveLength(2);
    for (const iso of isos)
      expect(new Date(iso).getTime()).toBeLessThan(now.getTime());
  });

  it("AiJobRepository.markStaleRunning binds the heartbeat cutoff as an ISO string", async () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const reaped = await new AiJobRepository().markStaleRunning(now);
    expect(reaped).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("heartbeat_at");
    expect(calls[0].params.some((p) => p instanceof Date)).toBe(false);
    const iso = calls[0].params.find(
      (p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(p),
    ) as string;
    expect(new Date(iso).getTime()).toBeLessThan(now.getTime());
  });
});
