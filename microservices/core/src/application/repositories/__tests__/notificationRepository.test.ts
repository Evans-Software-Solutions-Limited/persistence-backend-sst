/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/**
 * Build a chained .select() mock that mirrors the Drizzle fluent API:
 *   db.select().from().where().orderBy().limit().offset()
 * Resolves the supplied value at the terminal node.
 */
function makeSelectChain(resolvedValue: unknown) {
  const offset = vi.fn().mockResolvedValue(resolvedValue);
  const limit = vi.fn().mockReturnValue({ offset });
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  return {
    from: vi.fn().mockReturnValue({ where, orderBy, limit, offset }),
  };
}

/**
 * Chain for the count-unread query — no orderBy/limit/offset terminals,
 * resolves at where().
 */
function makeCountChain(resolvedValue: unknown) {
  const where = vi.fn().mockResolvedValue(resolvedValue);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function makeUpdateChain(resolvedValue: unknown) {
  const returning = vi.fn().mockResolvedValue(resolvedValue);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set };
}

const baseRow = {
  id: "n1",
  userId: "user-1",
  type: "workout_assigned",
  title: "Push Day",
  message: "Your trainer assigned a workout",
  data: { deepLink: "/(app)/(tabs)/workouts" },
  isRead: false,
  readAt: null,
  relatedEntityType: null,
  relatedEntityId: null,
  createdAt: new Date("2026-05-27T10:00:00Z"),
};

describe("NotificationRepository.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps rows to wire shape with default data + read state", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([baseRow])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.list("user-1", {
      limit: 50,
      offset: 0,
      unreadOnly: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "n1",
      userId: "user-1",
      type: "workout_assigned",
      title: "Push Day",
      message: "Your trainer assigned a workout",
      data: { deepLink: "/(app)/(tabs)/workouts" },
      isRead: false,
      readAt: null,
      relatedEntityType: null,
      relatedEntityId: null,
      createdAt: "2026-05-27T10:00:00.000Z",
    });
  });

  it("coerces empty data + null timestamps cleanly", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(
        makeSelectChain([
          {
            ...baseRow,
            data: null,
            message: null,
            isRead: true,
            readAt: new Date("2026-05-27T11:00:00Z"),
            createdAt: "2026-05-27T10:00:00Z",
          },
        ]),
      ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.list("user-1", {
      limit: 50,
      offset: 0,
      unreadOnly: false,
    });

    expect(result[0].data).toEqual({});
    expect(result[0].message).toBeNull();
    expect(result[0].isRead).toBe(true);
    expect(result[0].readAt).toBe("2026-05-27T11:00:00.000Z");
    expect(result[0].createdAt).toBe("2026-05-27T10:00:00.000Z");
  });

  it("falls back to epoch when createdAt is invalid", async () => {
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValue(
          makeSelectChain([{ ...baseRow, createdAt: "not-a-date" }]),
        ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.list("user-1", {
      limit: 50,
      offset: 0,
      unreadOnly: false,
    });

    expect(result[0].createdAt).toBe(new Date(0).toISOString());
  });

  it("invokes the AND-of-isRead-false predicate when unreadOnly", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    await repo.list("user-1", { limit: 25, offset: 5, unreadOnly: true });

    const fromChain = mockDb.select.mock.results[0].value;
    expect(fromChain.from).toHaveBeenCalled();
    const whereCall = fromChain.from.mock.results[0].value.where;
    expect(whereCall).toHaveBeenCalled();
  });
});

describe("NotificationRepository.countUnread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the int count from the first row", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeCountChain([{ total: 7 }])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.countUnread("user-1");

    expect(result).toBe(7);
  });

  it("returns 0 when the count query yields no rows", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeCountChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.countUnread("user-1");

    expect(result).toBe(0);
  });
});

describe("NotificationRepository.markRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the updated row when the WHERE matches", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(
        makeUpdateChain([
          {
            ...baseRow,
            isRead: true,
            readAt: new Date("2026-05-27T12:00:00Z"),
          },
        ]),
      ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.markRead("user-1", "n1");

    expect(result?.isRead).toBe(true);
    expect(result?.readAt).toBe("2026-05-27T12:00:00.000Z");
  });

  it("returns null when no row matches the userId+id WHERE", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.markRead("user-1", "n1");

    expect(result).toBeNull();
  });

  it("folds userId AND notificationId into the UPDATE WHERE clause", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain([baseRow])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    await repo.markRead("user-1", "n1");

    const updateChain = mockDb.update.mock.results[0].value;
    const setChain = updateChain.set.mock.results[0].value;
    // .where(...).returning() — the WHERE must be set on the chain
    expect(setChain.where).toHaveBeenCalled();
    // The set payload flips isRead and stamps readAt
    const setPayload = updateChain.set.mock.calls[0][0];
    expect(setPayload.isRead).toBe(true);
    expect(setPayload.readAt).toBeInstanceOf(Date);
  });
});

describe("NotificationRepository.markAllRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the number of rows newly marked read", async () => {
    const mockDb = {
      update: vi
        .fn()
        .mockReturnValue(
          makeUpdateChain([{ id: "n1" }, { id: "n2" }, { id: "n3" }]),
        ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.markAllRead("user-1");

    expect(result).toBe(3);
  });

  it("returns 0 when there are no unread rows", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.markAllRead("user-1");

    expect(result).toBe(0);
  });

  it("issues an UPDATE with isRead=true + readAt timestamped", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    await repo.markAllRead("user-1");

    const updateChain = mockDb.update.mock.results[0].value;
    const setPayload = updateChain.set.mock.calls[0][0];
    expect(setPayload.isRead).toBe(true);
    expect(setPayload.readAt).toBeInstanceOf(Date);
  });
});
