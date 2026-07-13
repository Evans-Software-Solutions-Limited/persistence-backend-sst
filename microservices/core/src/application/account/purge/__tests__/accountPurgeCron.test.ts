import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  accountPurgeCron,
  type AccountPurgeCronDeps,
} from "../accountPurgeCron";

function defaultAccountRepo() {
  return {
    listPendingPurge: vi.fn(async () => [] as string[]),
    purgeUserData: vi.fn(async () => undefined),
  };
}
type MockAccountRepo = ReturnType<typeof defaultAccountRepo>;

/**
 * Build a full `AccountPurgeCronDeps` with sensible no-op defaults, letting
 * each test override just the fields it cares about. Return type is
 * inferred (not declared) so each `vi.fn(...)` keeps its own precise Mock
 * generic — annotating the return shape with a widened `ReturnType<typeof
 * vi.fn>` breaks structural assignability between differently-typed mocks.
 */
function buildDeps(
  overrides: {
    accountRepo?: MockAccountRepo;
    cancelStripeSubscriptions?: AccountPurgeCronDeps["cancelStripeSubscriptions"];
    deleteAuthUser?: AccountPurgeCronDeps["deleteAuthUser"];
    deleteAvatar?: AccountPurgeCronDeps["deleteAvatar"];
    now?: Date;
  } = {},
) {
  return {
    accountRepo: defaultAccountRepo(),
    cancelStripeSubscriptions: vi.fn(async () => undefined),
    deleteAuthUser: vi.fn(async () => undefined),
    deleteAvatar: vi.fn(async () => undefined),
    now: new Date("2026-08-12T00:00:00.000Z"),
    ...overrides,
  } satisfies AccountPurgeCronDeps & { accountRepo: MockAccountRepo };
}

describe("accountPurgeCron", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing (all zero) when no account is due", async () => {
    const deps = buildDeps();
    const summary = await accountPurgeCron(deps);
    expect(summary).toEqual({ pending: 0, purged: 0, failed: 0 });
    expect(deps.accountRepo.purgeUserData).not.toHaveBeenCalled();
  });

  it("runs the full per-user pipeline in order: cancel → purge → auth-delete → avatar", async () => {
    const order: string[] = [];
    const deps = buildDeps({
      accountRepo: {
        listPendingPurge: vi.fn(async () => ["user-1"]),
        purgeUserData: vi.fn(async () => {
          order.push("purge");
        }),
      },
      cancelStripeSubscriptions: vi.fn(async () => {
        order.push("cancel");
      }),
      deleteAuthUser: vi.fn(async () => {
        order.push("auth-delete");
      }),
      deleteAvatar: vi.fn(async () => {
        order.push("avatar");
      }),
    });

    const summary = await accountPurgeCron(deps);

    expect(order).toEqual(["cancel", "purge", "auth-delete", "avatar"]);
    expect(summary).toEqual({ pending: 1, purged: 1, failed: 0 });
    expect(deps.accountRepo.purgeUserData).toHaveBeenCalledWith("user-1");
    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-1");
    expect(deps.deleteAvatar).toHaveBeenCalledWith("user-1");
  });

  it("processes every pending user even when one fails (isolation — one bad user doesn't abort the batch)", async () => {
    const deps = buildDeps({
      accountRepo: {
        listPendingPurge: vi.fn(async () => ["user-bad", "user-good"]),
        purgeUserData: vi.fn(async (userId: string) => {
          if (userId === "user-bad") throw new Error("constraint violation");
        }),
      },
    });

    const summary = await accountPurgeCron(deps);

    expect(summary).toEqual({ pending: 2, purged: 1, failed: 1 });
    expect(deps.accountRepo.purgeUserData).toHaveBeenCalledWith("user-bad");
    expect(deps.accountRepo.purgeUserData).toHaveBeenCalledWith("user-good");
    // The failed user never reaches auth-delete/avatar (the purge itself
    // didn't commit, so there's nothing to clean up yet — retried next
    // sweep).
    expect(deps.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user-good");
  });

  it("proceeds with the purge even when the Stripe safety-net cancel fails (30-day deadline wins over a Stripe hiccup)", async () => {
    const deps = buildDeps({
      accountRepo: {
        listPendingPurge: vi.fn(async () => ["user-1"]),
        purgeUserData: vi.fn(async () => undefined),
      },
      cancelStripeSubscriptions: vi.fn(async () => {
        throw new Error("Stripe down");
      }),
    });

    const summary = await accountPurgeCron(deps);

    expect(summary).toEqual({ pending: 1, purged: 1, failed: 0 });
    expect(deps.accountRepo.purgeUserData).toHaveBeenCalledWith("user-1");
  });

  it("still counts the user as purged when the auth-user delete fails (data is already gone — logged for ops cleanup)", async () => {
    const deps = buildDeps({
      accountRepo: {
        listPendingPurge: vi.fn(async () => ["user-1"]),
        purgeUserData: vi.fn(async () => undefined),
      },
      deleteAuthUser: vi.fn(async () => {
        throw new Error("admin 503");
      }),
    });

    const summary = await accountPurgeCron(deps);

    expect(summary).toEqual({ pending: 1, purged: 1, failed: 0 });
    // Avatar cleanup still runs even though auth-delete failed.
    expect(deps.deleteAvatar).toHaveBeenCalledWith("user-1");
  });

  it("still counts the user as purged when the avatar cleanup unexpectedly throws", async () => {
    const deps = buildDeps({
      accountRepo: {
        listPendingPurge: vi.fn(async () => ["user-1"]),
        purgeUserData: vi.fn(async () => undefined),
      },
      deleteAvatar: vi.fn(async () => {
        throw new Error("unexpected S3 throw");
      }),
    });

    const summary = await accountPurgeCron(deps);
    expect(summary).toEqual({ pending: 1, purged: 1, failed: 0 });
  });

  it("passes the injected `now` through to listPendingPurge (deterministic clock)", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    const deps = buildDeps({ now });
    await accountPurgeCron(deps);
    expect(deps.accountRepo.listPendingPurge).toHaveBeenCalledWith(now);
  });
});
