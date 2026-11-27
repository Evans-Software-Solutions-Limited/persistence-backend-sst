/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeInsertChain(resolvedValue: unknown) {
  const returning = vi.fn().mockResolvedValue(resolvedValue);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  return {
    values: vi.fn().mockReturnValue({ onConflictDoUpdate, returning }),
  };
}

function makeSelectChain(resolvedValue: unknown) {
  const limit = vi.fn().mockResolvedValue(resolvedValue);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

// `listActiveTokens`: `.from(...).innerJoin(...).where(...)` (no `.limit`).
function makeListChain(resolvedValue: unknown) {
  const where = vi.fn().mockResolvedValue(resolvedValue);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }), innerJoin, where };
}

// `deactivateToken`: `.update(...).set(...).where(...)`.
function makeUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { set, _where: where };
}

describe("UserDeviceRepository.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts and returns the device row", async () => {
    const mockDevice = {
      id: "device-1",
      userId: "user-1",
      deviceToken: "ExponentPushToken[abc]",
      platform: "ios",
      deviceInfo: {},
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsedAt: new Date(),
    };
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain()),
      insert: vi.fn().mockReturnValue(makeInsertChain([mockDevice])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    const result = await repo.register("user-1", {
      deviceToken: "ExponentPushToken[abc]",
      platform: "ios",
    });

    expect(result).toEqual(mockDevice);
  });

  it("deactivates OTHER users' active rows for the same token before upserting", async () => {
    // One phone token = one signed-in account. Registering it must take the
    // token away from whichever account held it before (e.g. a test account
    // signed out offline), or that account's pushes keep landing here.
    const calls: string[] = [];
    const updateChain = makeUpdateChain();
    const mockDb = {
      update: vi.fn(() => {
        calls.push("update");
        return updateChain;
      }),
      insert: vi.fn(() => {
        calls.push("insert");
        return makeInsertChain([{ id: "device-1", userId: "user-1" }]);
      }),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const { userDevices } = await import("@persistence/db");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const repo = new UserDeviceRepository();
    await repo.register("user-1", {
      deviceToken: "ExponentPushToken[abc]",
      platform: "ios",
    });

    expect(calls).toEqual(["update", "insert"]);
    expect(mockDb.update).toHaveBeenCalledWith(userDevices);
    expect(updateChain.set.mock.calls[0][0].isActive).toBe(false);

    const query = new PgDialect().sqlToQuery(
      updateChain._where.mock.calls[0][0],
    );
    expect(query.sql).toBe(
      '("user_devices"."device_token" = $1 and "user_devices"."user_id" <> $2 and "user_devices"."is_active" = $3)',
    );
    expect(query.params).toEqual(["ExponentPushToken[abc]", "user-1", true]);
  });

  it("forwards deviceInfo to both INSERT and the ON CONFLICT SET clause", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain()),
      insert: vi
        .fn()
        .mockReturnValue(
          makeInsertChain([{ id: "device-1", userId: "user-1" }]),
        ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    await repo.register("user-1", {
      deviceToken: "ExponentPushToken[abc]",
      platform: "android",
      deviceInfo: {
        deviceName: "Pixel 8",
        osVersion: "Android 15",
        appVersion: "2.4.1",
        modelName: "Pixel 8 Pro",
      },
    });

    const valuesCall =
      mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesCall.deviceInfo).toMatchObject({
      deviceName: "Pixel 8",
      osVersion: "Android 15",
      appVersion: "2.4.1",
      modelName: "Pixel 8 Pro",
    });
    expect(valuesCall.isActive).toBe(true);

    const onConflictCall =
      mockDb.insert.mock.results[0].value.values.mock.results[0].value
        .onConflictDoUpdate.mock.calls[0][0];
    expect(onConflictCall.target).toBeDefined();
    expect(onConflictCall.set.isActive).toBe(true);
    expect(onConflictCall.set.deviceInfo).toMatchObject({
      deviceName: "Pixel 8",
    });
  });

  it("defaults deviceInfo to an empty object when omitted", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain()),
      insert: vi
        .fn()
        .mockReturnValue(
          makeInsertChain([{ id: "device-1", userId: "user-1" }]),
        ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    await repo.register("user-1", {
      deviceToken: "ExponentPushToken[abc]",
      platform: "web",
    });

    const valuesCall =
      mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(valuesCall.deviceInfo).toEqual({});
  });

  it("throws when the UPSERT returns no rows (driver bug)", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain()),
      insert: vi.fn().mockReturnValue(makeInsertChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();

    await expect(
      repo.register("user-1", {
        deviceToken: "ExponentPushToken[abc]",
        platform: "ios",
      }),
    ).rejects.toThrow(/UPSERT returned no rows/);
  });
});

describe("UserDeviceRepository.findByUserAndToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the row when found", async () => {
    const row = {
      id: "device-1",
      userId: "user-1",
      deviceToken: "tok",
      platform: "ios",
      isActive: true,
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([row])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    const result = await repo.findByUserAndToken("user-1", "tok");

    expect(result).toEqual(row);
  });

  it("returns null when no row matches", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    const result = await repo.findByUserAndToken("user-1", "tok");

    expect(result).toBeNull();
  });
});

describe("UserDeviceRepository.listActiveTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only deviceToken + platform for active devices", async () => {
    const rows = [
      { deviceToken: "ExponentPushToken[a]", platform: "ios" },
      { deviceToken: "ExponentPushToken[b]", platform: "android" },
    ];
    const mockDb = {
      select: vi.fn().mockReturnValue(makeListChain(rows)),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    const result = await repo.listActiveTokens("user-1");

    expect(result).toEqual([
      { deviceToken: "ExponentPushToken[a]", platform: "ios" },
      { deviceToken: "ExponentPushToken[b]", platform: "android" },
    ]);
  });

  it("only targets active rows of the user, and nothing while the account is soft-deleted", async () => {
    // A deleted account's rows can be switched back on by a phone still
    // signed in to it re-registering; the lookup itself must stay silent.
    const chain = makeListChain([]);
    (getDb as any).mockReturnValue({ select: vi.fn().mockReturnValue(chain) });

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const { profiles } = await import("@persistence/db");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    await new UserDeviceRepository().listActiveTokens("user-1");

    const dialect = new PgDialect();
    expect(chain.innerJoin.mock.calls[0][0]).toBe(profiles);
    expect(dialect.sqlToQuery(chain.innerJoin.mock.calls[0][1]).sql).toBe(
      '"profiles"."id" = "user_devices"."user_id"',
    );
    const where = dialect.sqlToQuery(chain.where.mock.calls[0][0]);
    expect(where.sql).toBe(
      '("user_devices"."user_id" = $1 and "user_devices"."is_active" = $2 and "profiles"."deleted_at" is null)',
    );
    expect(where.params).toEqual(["user-1", true]);
  });

  it("returns an empty array when the user has no active devices", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeListChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    const result = await repo.listActiveTokens("user-1");

    expect(result).toEqual([]);
  });
});

describe("UserDeviceRepository.deleteForUserAndToken (PER-149)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only the caller's row for that exact token", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const mockDb = { delete: vi.fn().mockReturnValue({ where }) };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const { userDevices } = await import("@persistence/db");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    await new UserDeviceRepository().deleteForUserAndToken(
      "user-1",
      "a3f1c2d4e5b6",
    );

    expect(mockDb.delete).toHaveBeenCalledWith(userDevices);
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    // Scoped to the caller: another user's row with the same token is
    // never matched.
    expect(query.sql).toBe(
      '("user_devices"."user_id" = $1 and "user_devices"."device_token" = $2)',
    );
    expect(query.params).toEqual(["user-1", "a3f1c2d4e5b6"]);
  });
});

describe("UserDeviceRepository.deactivateToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues an UPDATE setting isActive false", async () => {
    const updateChain = makeUpdateChain();
    const mockDb = { update: vi.fn().mockReturnValue(updateChain) };
    (getDb as any).mockReturnValue(mockDb);

    const { UserDeviceRepository } = await import("../userDeviceRepository");
    const repo = new UserDeviceRepository();
    await repo.deactivateToken("user-1", "ExponentPushToken[dead]");

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.isActive).toBe(false);
    expect(updateChain._where).toHaveBeenCalledTimes(1);
  });
});
