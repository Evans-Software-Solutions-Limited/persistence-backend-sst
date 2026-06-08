/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/**
 * Build a chained .select() mock that mirrors the Drizzle fluent API:
 *   db.select().from().where().orderBy().limit()
 * Resolves the supplied value at the terminal `.limit()` node, and
 * exposes the `limit` spy so tests can assert the `limit + 1` fetch.
 */
function makeSelectChain(resolvedValue: unknown) {
  const limit = vi.fn().mockResolvedValue(resolvedValue);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  return {
    limit,
    from: vi.fn().mockReturnValue({ where, orderBy, limit }),
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
  // Full microsecond-precision cursor key (timestamptz::text), as the
  // repo now selects it. Used to build nextCursor losslessly.
  createdAtCursor: "2026-05-27 10:00:00+00",
};

describe("NotificationRepository cursor helpers", () => {
  it("round-trips a (createdAt, id) position through encode/decode", async () => {
    const { encodeCursor, decodeCursor } =
      await import("../notificationRepository");
    const pos = { createdAt: "2026-05-27T10:00:00.000Z", id: "n1" };
    const token = encodeCursor(pos);
    // base64url is opaque and URL-safe — no '+', '/', or '=' padding.
    expect(token).not.toMatch(/[+/=]/);
    expect(decodeCursor(token)).toEqual(pos);
  });

  it("round-trips a microsecond-precise timestamptz::text cursor", async () => {
    const { encodeCursor, decodeCursor } =
      await import("../notificationRepository");
    // Postgres `timestamptz::text` shape, microsecond precision.
    const pos = { createdAt: "2026-05-27 10:00:00.123456+00", id: "n1" };
    const token = encodeCursor(pos);
    expect(token).not.toMatch(/[+/=]/);
    // Full microsecond precision survives the round-trip unchanged — no
    // truncation to milliseconds.
    expect(decodeCursor(token)).toEqual(pos);
  });

  it("rejects non-base64 / non-JSON tokens", async () => {
    const { decodeCursor, InvalidCursorError } =
      await import("../notificationRepository");
    // Buffer.from is lenient on base64url, so force a JSON.parse failure
    // with a token that decodes to non-JSON bytes.
    const notJson = Buffer.from("not json at all", "utf8").toString(
      "base64url",
    );
    expect(() => decodeCursor(notJson)).toThrow(InvalidCursorError);
  });

  it("rejects a token missing required fields", async () => {
    const { encodeCursor, decodeCursor, InvalidCursorError } =
      await import("../notificationRepository");
    const badShape = Buffer.from(
      JSON.stringify({ c: "2026-05-27T10:00:00.000Z" }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeCursor(badShape)).toThrow(InvalidCursorError);
    // empty id
    const emptyId = encodeCursor({
      createdAt: "2026-05-27T10:00:00.000Z",
      id: "",
    });
    expect(() => decodeCursor(emptyId)).toThrow(InvalidCursorError);
  });

  it("rejects a token whose createdAt is not a parseable date", async () => {
    const { decodeCursor, InvalidCursorError } =
      await import("../notificationRepository");
    const badDate = Buffer.from(
      JSON.stringify({ c: "not-a-date", i: "n1" }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeCursor(badDate)).toThrow(InvalidCursorError);
  });
});

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
      unreadOnly: false,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(result.rows[0]).toEqual({
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

  it("fetches limit + 1 rows to detect a next page", async () => {
    const chain = makeSelectChain([baseRow]);
    const mockDb = { select: vi.fn().mockReturnValue(chain) };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    await repo.list("user-1", { limit: 50, unreadOnly: false });

    expect(chain.limit).toHaveBeenCalledWith(51);
  });

  it("drops the surplus row and emits a nextCursor when there's more", async () => {
    // limit=1, repo fetches 2 → there IS a next page.
    const second = {
      ...baseRow,
      id: "n2",
      createdAt: new Date("2026-05-27T09:00:00Z"),
      createdAtCursor: "2026-05-27 09:00:00+00",
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([baseRow, second])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository, decodeCursor } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.list("user-1", { limit: 1, unreadOnly: false });

    // Only the first row is returned; the surplus row is dropped.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe("n1");
    // nextCursor points at the LAST returned row (n1), not the surplus,
    // and carries the FULL-PRECISION createdAtCursor (not the wire ISO).
    expect(result.nextCursor).not.toBeNull();
    expect(decodeCursor(result.nextCursor as string)).toEqual({
      createdAt: "2026-05-27 10:00:00+00",
      id: "n1",
    });
  });

  it("returns nextCursor=null on the last page", async () => {
    // limit=2, repo fetches 2 → no surplus → last page.
    const second = {
      ...baseRow,
      id: "n2",
      createdAt: new Date("2026-05-27T09:00:00Z"),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([baseRow, second])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const result = await repo.list("user-1", { limit: 2, unreadOnly: false });

    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("applies a keyset WHERE when a valid cursor is supplied", async () => {
    const chain = makeSelectChain([]);
    const mockDb = { select: vi.fn().mockReturnValue(chain) };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository, encodeCursor } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const cursor = encodeCursor({
      createdAt: "2026-05-27T10:00:00.000Z",
      id: "n1",
    });
    const result = await repo.list("user-1", {
      limit: 50,
      cursor,
      unreadOnly: false,
    });

    // where() got called (with userId + keyset folded in).
    const whereSpy = chain.from.mock.results[0].value.where;
    expect(whereSpy).toHaveBeenCalled();
    expect(result.rows).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("throws InvalidCursorError on a malformed cursor (no DB hit)", async () => {
    const mockDb = { select: vi.fn().mockReturnValue(makeSelectChain([])) };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository, InvalidCursorError } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();

    await expect(
      repo.list("user-1", {
        limit: 50,
        cursor: "::: not a valid token :::",
        unreadOnly: false,
      }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    // Decoding fails before the query is ever issued.
    expect(mockDb.select).not.toHaveBeenCalled();
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
      unreadOnly: false,
    });

    expect(result.rows[0].data).toEqual({});
    expect(result.rows[0].message).toBeNull();
    expect(result.rows[0].isRead).toBe(true);
    expect(result.rows[0].readAt).toBe("2026-05-27T11:00:00.000Z");
    expect(result.rows[0].createdAt).toBe("2026-05-27T10:00:00.000Z");
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
      unreadOnly: false,
    });

    expect(result.rows[0].createdAt).toBe(new Date(0).toISOString());
  });

  it("pages through sub-millisecond siblings without skipping any (microsecond cursor regression)", async () => {
    // Regression: three rows share the SAME millisecond but differ in
    // MICROseconds. A JS-Date cursor truncates to ms, so the keyset
    // `created_at < c OR (= c AND id < i)` would skip siblings whose
    // created_at lies in the truncated sub-ms gap, losing a page's tail
    // forever. With a timestamptz::text cursor the comparison is exact.
    //
    // We seed a microsecond-precise dataset (newest-first) and emulate
    // Postgres: each page is the dataset filtered by the decoded cursor
    // using the SAME (created_at DESC, id DESC) keyset Postgres applies,
    // compared at full string precision.
    const dataset = [
      {
        ...baseRow,
        id: "n-a",
        createdAt: new Date("2026-05-27T10:00:00.123Z"),
        createdAtCursor: "2026-05-27 10:00:00.123900+00",
      },
      {
        ...baseRow,
        id: "n-b",
        createdAt: new Date("2026-05-27T10:00:00.123Z"),
        createdAtCursor: "2026-05-27 10:00:00.123654+00",
      },
      {
        ...baseRow,
        id: "n-c",
        createdAt: new Date("2026-05-27T10:00:00.123Z"),
        createdAtCursor: "2026-05-27 10:00:00.123456+00",
      },
      {
        ...baseRow,
        id: "n-d",
        createdAt: new Date("2026-05-27T09:59:59.000Z"),
        createdAtCursor: "2026-05-27 09:59:59.000000+00",
      },
    ];

    // Keyset comparator matching `created_at DESC, id DESC`, full
    // string precision: a row is "after" the cursor (belongs on a later
    // page) iff createdAtCursor < c, OR (== c AND id < i).
    const afterCursor = (row: (typeof dataset)[number], c: string, i: string) =>
      row.createdAtCursor < c || (row.createdAtCursor === c && row.id < i);

    const { NotificationRepository, decodeCursor } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    const limit = 2;

    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const decoded = cursor ? decodeCursor(cursor) : null;
      const remaining = decoded
        ? dataset.filter((r) => afterCursor(r, decoded.createdAt, decoded.id))
        : dataset;
      // Postgres returns up to limit+1 rows for the page; the repo
      // fetches limit+1 to detect a further page.
      const page = remaining.slice(0, limit + 1);

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain(page)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const result = await repo.list("user-1", { limit, unreadOnly: false });
      for (const r of result.rows) seen.push(r.id);
      cursor = result.nextCursor ?? undefined;
      guard += 1;
    } while (cursor !== undefined && guard < 10);

    // Every row appears exactly once, in order, none skipped/duplicated.
    expect(seen).toEqual(["n-a", "n-b", "n-c", "n-d"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("invokes the AND-of-isRead-false predicate when unreadOnly", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { NotificationRepository } =
      await import("../notificationRepository");
    const repo = new NotificationRepository();
    await repo.list("user-1", { limit: 25, unreadOnly: true });

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
    // Inspector Brad PR #81 sweep 2: readAt is COALESCE(read_at, NOW())
    // so idempotent replays preserve the original read-moment. It's a
    // Drizzle SQL expression now (has a queryChunks array), not a plain Date.
    expect(setPayload.readAt).not.toBeInstanceOf(Date);
    expect(setPayload.readAt).toMatchObject({
      queryChunks: expect.any(Array),
    });
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
