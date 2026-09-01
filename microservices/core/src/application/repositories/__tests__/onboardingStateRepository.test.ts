/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { OnboardingStateRepository } from "../onboardingStateRepository";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function persisted(status: "in_progress" | "completed" | "dismissed") {
  return {
    userId: USER_A,
    version: 1,
    currentPage: "welcome",
    completedPages: [],
    skippedPages: [],
    status,
    path: null,
    coachClientBand: null,
    intentKeys: [],
    completedAt: null,
    dismissedAt: null,
    updatedAt: new Date("2026-09-01T10:00:00Z"),
  };
}

function selectDb(rows: unknown[], capture: { where?: unknown } = {}) {
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn((where) => {
    capture.where = where;
    return chain;
  });
  chain.limit = vi.fn(async () => rows);
  return { select: vi.fn(() => chain) };
}

describe("OnboardingStateRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no row exists so the client can seed first-run defaults", async () => {
    (getDb as any).mockReturnValue(selectDb([]));
    const out = await new OnboardingStateRepository().get(USER_A);
    expect(out).toBeNull();
  });

  it("scopes reads to the caller and never another user", async () => {
    const capture: { where?: unknown } = {};
    (getDb as any).mockReturnValue(selectDb([], capture));
    await new OnboardingStateRepository().get(USER_A);
    const query = new PgDialect().sqlToQuery(capture.where as never);
    expect(query.sql).toContain('"onboarding_states"."user_id" = $1');
    expect(query.params).toEqual([USER_A]);
    expect(query.params).not.toContain(USER_B);
  });

  it("maps a persisted row to the exact wire DTO", async () => {
    (getDb as any).mockReturnValue(
      selectDb([
        {
          userId: USER_A,
          version: 1,
          currentPage: "recommendation",
          completedPages: ["welcome", "profile"],
          skippedPages: ["habits"],
          status: "dismissed",
          path: "coach",
          coachClientBand: "6_15",
          intentKeys: ["training_loadout"],
          completedAt: null,
          dismissedAt: "2026-09-01T10:00:00.000Z",
          updatedAt: new Date("2026-09-01T10:00:01.000Z"),
        },
      ]),
    );
    expect(await new OnboardingStateRepository().get(USER_A)).toEqual({
      userId: USER_A,
      version: 1,
      currentPage: "recommendation",
      completedPages: ["welcome", "profile"],
      skippedPages: ["habits"],
      status: "dismissed",
      path: "coach",
      coachClientBand: "6_15",
      intentKeys: ["training_loadout"],
      completedAt: null,
      dismissedAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:01.000Z",
    });
  });

  it("guards terminal rows atomically from stale progress writes", async () => {
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const insert = {
      values: vi.fn(() => ({ onConflictDoUpdate })),
    };
    const terminal = {
      ...persisted("completed"),
      status: "completed",
      completedAt: new Date("2026-09-01T10:00:00Z"),
      updatedAt: new Date("2026-09-01T10:00:00Z"),
    };
    const db = { ...selectDb([terminal]), insert: vi.fn(() => insert) };
    (getDb as any).mockReturnValue(db);

    const out = await new OnboardingStateRepository().put(USER_A, {
      version: 1,
      currentPage: "profile",
      completedPages: ["welcome"],
      skippedPages: [],
      status: "in_progress",
      path: "athlete",
      coachClientBand: null,
      intentKeys: [],
    });
    const conflict = (onConflictDoUpdate as any).mock.calls[0][0];
    expect(new PgDialect().sqlToQuery(conflict.setWhere).sql).toContain(
      '"onboarding_states"."status" = \'in_progress\'',
    );
    expect(out.status).toBe("completed");
  });

  it("dedupes arrays, stamps completion, and preserves a coach band", async () => {
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const completed = {
      ...persisted("completed"),
      status: "completed",
      path: "coach",
      coachClientBand: "1_5",
      completedAt: new Date("2026-09-01T11:00:00Z"),
      updatedAt: new Date("2026-09-01T11:00:00Z"),
    };
    (getDb as any).mockReturnValue({
      ...selectDb([completed]),
      insert: vi.fn(() => ({ values })),
    });
    await new OnboardingStateRepository().put(USER_A, {
      version: 1,
      currentPage: "recommendation",
      completedPages: ["welcome", "welcome"],
      skippedPages: ["habits", "habits"],
      status: "completed",
      path: "coach",
      coachClientBand: "1_5",
      intentKeys: ["training_loadout", "training_loadout"],
    });
    const written = (values as any).mock.calls[0][0] as any;
    expect(written.completedPages).toEqual(["welcome"]);
    expect(written.skippedPages).toEqual(["habits"]);
    expect(written.intentKeys).toEqual(["training_loadout"]);
    expect(written.coachClientBand).toBe("1_5");
    expect(written.completedAt).toBeInstanceOf(Date);
    expect(written.dismissedAt).toBeNull();
  });

  it("clears coach band for athletes and stamps dismissal", async () => {
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const dismissed = {
      ...persisted("dismissed"),
      status: "dismissed",
      dismissedAt: new Date(),
      updatedAt: new Date(),
    };
    (getDb as any).mockReturnValue({
      ...selectDb([dismissed]),
      insert: vi.fn(() => ({ values })),
    });
    await new OnboardingStateRepository().put(USER_A, {
      version: 1,
      currentPage: "welcome",
      completedPages: [],
      skippedPages: [],
      status: "dismissed",
      path: "athlete",
      coachClientBand: "16_30",
      intentKeys: [],
    });
    const written = (values as any).mock.calls[0][0] as any;
    expect(written.coachClientBand).toBeNull();
    expect(written.completedAt).toBeNull();
    expect(written.dismissedAt).toBeInstanceOf(Date);
  });

  it("fails loudly if an upsert cannot be re-read", async () => {
    const onConflictDoUpdate = vi.fn(async () => undefined);
    (getDb as any).mockReturnValue({
      ...selectDb([]),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ onConflictDoUpdate })),
      })),
    });
    await expect(
      new OnboardingStateRepository().put(USER_A, {
        version: 1,
        currentPage: "welcome",
        completedPages: [],
        skippedPages: [],
        status: "in_progress",
        path: null,
        coachClientBand: null,
        intentKeys: [],
      }),
    ).rejects.toThrow("onboarding_state_upsert_failed");
  });
});
