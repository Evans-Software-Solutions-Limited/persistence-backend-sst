import {
  COACH_OVERVIEW_STALE_AFTER_MS,
  isCoachOverviewStale,
} from "../useGetCoachOverview";

describe("isCoachOverviewStale", () => {
  const now = 1_000_000_000_000;

  it("is stale when there is no synced timestamp", () => {
    expect(isCoachOverviewStale(null, now)).toBe(true);
  });

  it("is stale when the timestamp is unparseable", () => {
    expect(isCoachOverviewStale("garbage", now)).toBe(true);
  });

  it("is fresh within the TTL", () => {
    const recent = new Date(now - 1000).toISOString();
    expect(isCoachOverviewStale(recent, now)).toBe(false);
  });

  it("is stale past the TTL", () => {
    const old = new Date(
      now - COACH_OVERVIEW_STALE_AFTER_MS - 1000,
    ).toISOString();
    expect(isCoachOverviewStale(old, now)).toBe(true);
  });
});
