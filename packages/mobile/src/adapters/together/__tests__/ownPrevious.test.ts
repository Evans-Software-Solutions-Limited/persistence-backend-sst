import { refreshTogetherOwnPrevious } from "../ownPrevious";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { ok } from "@/shared/errors";
import type { AuthPort } from "@/domain/ports/auth.port";

const row = {
  exerciseId: "squat",
  setNumber: 1,
  reps: 8,
  weightKg: 60,
  recordedAt: "2026-10-01T10:00:00Z",
};
function setup() {
  const storage = new InMemoryStorageAdapter();
  let listener: Parameters<AuthPort["onAuthStateChange"]>[0] = () => {};
  const unsubscribe = jest.fn();
  const auth = {
    getSession: jest.fn(async () =>
      ok({
        userId: "owner",
        accessToken: "token",
        refreshToken: "refresh",
        email: "",
        expiresAt: 9999999999,
      }),
    ),
    onAuthStateChange: jest.fn((fn: typeof listener) => {
      listener = fn;
      return unsubscribe;
    }),
  };
  const deps = {
    storage,
    auth,
    api: { getRecentSets: jest.fn(async () => ok([row])) },
    netInfo: { isConnected: jest.fn(async () => true) },
    userId: "owner",
    exerciseIds: ["squat"],
    before: "2026-10-05T10:00:00Z",
    isCurrent: jest.fn(() => true),
  };
  return {
    deps,
    unsubscribe,
    change: (userId: string) =>
      listener(
        { userId, accessToken: "", refreshToken: "", email: "", expiresAt: 0 },
        "SIGNED_IN",
      ),
  };
}
it("requests only own relevant exercises before original start and hydrates cache", async () => {
  const { deps, unsubscribe } = setup();
  expect(await refreshTogetherOwnPrevious(deps)).toEqual([
    { ...row, recordedAt: Date.parse(row.recordedAt) },
  ]);
  expect(deps.api.getRecentSets).toHaveBeenCalledWith({
    exerciseIds: ["squat"],
    before: deps.before,
  });
  expect(
    deps.storage.getPreviousForTogether("owner", ["squat"], deps.before),
  ).toEqual([row]);
  expect(
    deps.storage.getPreviousForTogether("other", ["squat"], deps.before),
  ).toEqual([]);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
it("offline cache is immediate and missing history stays empty", async () => {
  const { deps } = setup();
  deps.netInfo.isConnected.mockResolvedValue(false);
  expect(await refreshTogetherOwnPrevious(deps)).toEqual([]);
  deps.storage.upsertRecentSets("owner", [row]);
  expect(await refreshTogetherOwnPrevious(deps)).toHaveLength(1);
  expect(deps.api.getRecentSets).not.toHaveBeenCalled();
});
it("does not overwrite newer offline history, including a row completed during fetch", async () => {
  const { deps } = setup();
  const newer = { ...row, recordedAt: "2026-10-06T10:00:00Z", weightKg: 90 };
  deps.api.getRecentSets.mockImplementation(async () => {
    deps.storage.upsertRecentSets("owner", [newer]);
    return ok([row]);
  });
  expect(await refreshTogetherOwnPrevious(deps)).toEqual([
    { ...row, recordedAt: Date.parse(row.recordedAt) },
  ]);
  expect(
    deps.storage.getPreviousForTogether(
      "owner",
      ["squat"],
      "2026-10-07T10:00:00Z",
    ),
  ).toEqual([newer]);
});
it.each(["account", "workout"])(
  "drops a response crossing %s even if account switches back",
  async (kind) => {
    const { deps, change } = setup();
    deps.api.getRecentSets.mockImplementation(async () => {
      if (kind === "account") {
        change("other");
        change("owner");
      } else deps.isCurrent.mockReturnValue(false);
      return ok([row]);
    });
    expect(await refreshTogetherOwnPrevious(deps)).toBeNull();
    expect(deps.storage.hasAnyRecentSets("owner")).toBe(false);
  },
);
it("does not fetch under another authenticated account", async () => {
  const { deps } = setup();
  deps.auth.getSession.mockResolvedValue(
    ok({
      userId: "other",
      accessToken: "",
      refreshToken: "",
      email: "",
      expiresAt: 0,
    }),
  );
  expect(await refreshTogetherOwnPrevious(deps)).toBeNull();
  expect(deps.api.getRecentSets).not.toHaveBeenCalled();
});
it("failed API preserves cached data and releases auth subscription", async () => {
  const { deps, unsubscribe } = setup();
  deps.storage.upsertRecentSets("owner", [row]);
  deps.api.getRecentSets.mockRejectedValue(new Error("offline"));
  expect(await refreshTogetherOwnPrevious(deps)).toHaveLength(1);
  expect(unsubscribe).toHaveBeenCalled();
});
it("filters unexpected exercises, new/faulty timestamps and invalid numeric values", async () => {
  const { deps } = setup();
  deps.api.getRecentSets.mockResolvedValue(
    ok([
      row,
      { ...row, exerciseId: "other" },
      { ...row, recordedAt: deps.before },
      { ...row, recordedAt: "bad" },
      { ...row, weightKg: NaN },
      { ...row, setNumber: 0 },
      { ...row, reps: -1 },
    ]),
  );
  expect(await refreshTogetherOwnPrevious(deps)).toHaveLength(1);
});
it("bounded invalid requests never fetch", async () => {
  const { deps } = setup();
  for (const exerciseIds of [[], Array.from({ length: 101 }, (_, i) => `${i}`)])
    expect(await refreshTogetherOwnPrevious({ ...deps, exerciseIds })).toEqual(
      [],
    );
  expect(await refreshTogetherOwnPrevious({ ...deps, before: "bad" })).toEqual(
    [],
  );
  expect(deps.api.getRecentSets).not.toHaveBeenCalled();
});
it("newer eligible cached rows win over older server data", async () => {
  const { deps } = setup();
  const newer = { ...row, recordedAt: "2026-10-04T10:00:00Z", weightKg: 70 };
  deps.storage.upsertRecentSets("owner", [newer]);
  expect(await refreshTogetherOwnPrevious(deps)).toEqual([
    { ...newer, recordedAt: Date.parse(newer.recordedAt) },
  ]);
});
