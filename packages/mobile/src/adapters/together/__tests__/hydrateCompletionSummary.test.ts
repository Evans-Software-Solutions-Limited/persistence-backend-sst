import { hydrateTogetherCompletionSummary } from "../hydrateCompletionSummary";
import type { ApiSession } from "../../../domain/ports/api.port";
import { ok, fail } from "../../../shared/errors/result";
const session = {
  id: "history",
  userId: "owner",
  status: "completed",
  personalRecords: [],
  workoutsThisMonth: 4,
} as unknown as ApiSession;
function setup() {
  return {
    api: { getSession: jest.fn(async () => ok(session)) },
    storage: { cacheRecordResponse: jest.fn() },
    userId: "owner",
    localSessionId: "local",
    historyId: "history",
    isCurrent: jest.fn(() => true),
  };
}
it("reads existing completion and caches canonical summary against the original local workout", async () => {
  const options = setup();
  expect(await hydrateTogetherCompletionSummary(options)).toBe(true);
  expect(options.api.getSession).toHaveBeenCalledWith("history", {
    summary: true,
  });
  expect(options.storage.cacheRecordResponse).toHaveBeenCalledWith("owner", {
    localSessionId: "local",
    personalRecords: [],
    workoutsThisMonth: 4,
    cachedAt: expect.any(String),
  });
});
it.each([
  { id: "other" },
  { userId: "other" },
  { status: "in_progress" },
  { personalRecords: undefined },
  { workoutsThisMonth: undefined },
  { workoutsThisMonth: -1 },
])(
  "keeps fallback for unavailable or mismatched summaries %o",
  async (patch) => {
    const options = setup();
    options.api.getSession.mockResolvedValue(
      ok({ ...session, ...patch } as ApiSession),
    );
    expect(await hydrateTogetherCompletionSummary(options)).toBe(false);
    expect(options.storage.cacheRecordResponse).not.toHaveBeenCalled();
  },
);
it("does not fetch pending effects or inactive scope, and drops a reply after account/workout changes", async () => {
  const options = setup();
  expect(
    await hydrateTogetherCompletionSummary({
      ...options,
      effectsPending: true,
    }),
  ).toBe(false);
  options.isCurrent.mockReturnValue(false);
  expect(await hydrateTogetherCompletionSummary(options)).toBe(false);
  expect(options.api.getSession).not.toHaveBeenCalled();
  options.isCurrent.mockReturnValueOnce(true).mockReturnValue(false);
  expect(await hydrateTogetherCompletionSummary(options)).toBe(false);
  expect(options.storage.cacheRecordResponse).not.toHaveBeenCalled();
});
it("keeps fallback for failed reads, missing history and cache errors", async () => {
  const options = setup();
  expect(
    await hydrateTogetherCompletionSummary({ ...options, historyId: "" }),
  ).toBe(false);
  options.api.getSession.mockResolvedValueOnce(
    fail({ kind: "api", code: "network", message: "offline" }) as never,
  );
  expect(await hydrateTogetherCompletionSummary(options)).toBe(false);
  options.storage.cacheRecordResponse.mockImplementation(() => {
    throw new Error("disk full");
  });
  expect(await hydrateTogetherCompletionSummary(options)).toBe(false);
});
