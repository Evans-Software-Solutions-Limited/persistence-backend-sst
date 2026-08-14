import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();

vi.mock("../../repositories/analyticsEventRepository", () => ({
  AnalyticsEventRepository: vi.fn(() => ({ insert: insertMock })),
}));

import { emitEvent } from "../emitEvent";

describe("emitEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("inserts the event via the repository", async () => {
    await emitEvent({
      name: "lead_captured",
      source: "web",
      properties: { audience: "athletes" },
    });
    expect(insertMock).toHaveBeenCalledWith({
      name: "lead_captured",
      source: "web",
      properties: { audience: "athletes" },
    });
  });

  it("swallows a DB error (never throws) and logs it", async () => {
    const err = new Error("db down");
    insertMock.mockRejectedValue(err);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      emitEvent({ name: "session_completed", userId: "u1" }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[analytics:emit] failed for session_completed"),
    );
  });
});
