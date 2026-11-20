import { needsRemote, youRemoteUnavailable } from "../youRemote";

describe("youRemote (BE-H1 seam)", () => {
  it("answers unavailable until PER-113 ships", async () => {
    await expect(youRemoteUnavailable.historyMonth("2026-10")).resolves.toEqual(
      { status: "unavailable" },
    );
    await expect(youRemoteUnavailable.recap("3months")).resolves.toEqual({
      status: "unavailable",
    });
    await expect(youRemoteUnavailable.lastSevenDays()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("needs the server for ranges before the phone's log", () => {
    const since = "2026-11-20T10:00:00.000Z";
    expect(needsRemote(since, new Date("2026-11-01T00:00:00Z"))).toBe(true);
    expect(needsRemote(since, new Date("2026-11-21T00:00:00Z"))).toBe(false);
    expect(needsRemote(null, new Date())).toBe(true);
  });
});
