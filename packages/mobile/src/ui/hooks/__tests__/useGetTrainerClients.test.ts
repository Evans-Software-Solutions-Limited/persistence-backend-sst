import {
  TRAINER_CLIENTS_STALE_AFTER_MS,
  isTrainerClientsStale,
} from "../useGetTrainerClients";

describe("isTrainerClientsStale", () => {
  const now = 1_000_000_000_000;

  it("is stale when there is no synced timestamp", () => {
    expect(isTrainerClientsStale(null, now)).toBe(true);
  });

  it("is stale when the timestamp is unparseable", () => {
    expect(isTrainerClientsStale("garbage", now)).toBe(true);
  });

  it("is fresh within the TTL", () => {
    const recent = new Date(now - 1000).toISOString();
    expect(isTrainerClientsStale(recent, now)).toBe(false);
  });

  it("is stale past the TTL", () => {
    const old = new Date(
      now - TRAINER_CLIENTS_STALE_AFTER_MS - 1000,
    ).toISOString();
    expect(isTrainerClientsStale(old, now)).toBe(true);
  });
});
