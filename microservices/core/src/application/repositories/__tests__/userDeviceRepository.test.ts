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

  it("forwards deviceInfo to both INSERT and the ON CONFLICT SET clause", async () => {
    const mockDb = {
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
