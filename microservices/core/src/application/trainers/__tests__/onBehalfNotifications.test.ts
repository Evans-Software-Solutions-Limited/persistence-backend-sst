/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

const dispatch = vi.fn();
vi.mock("../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: vi.fn(() => ({ createAndDispatch: dispatch })),
}));

import { getDb } from "@persistence/db/client";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

/** Thenable select-chain resolving to `rows` — mocks the profiles lookup. */
function dbReturning(rows: unknown[]) {
  const builder: any = {};
  const passthrough = () => builder;
  for (const m of ["select", "from", "where", "limit"]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
  return { select: builder.select };
}

const BASE = {
  clientId: "client-1",
  trainerId: "trainer-1",
  type: "workout_logged_on_behalf" as const,
  title: "Workout logged by your coach",
  buildMessage: (coachName: string) => `${coachName} logged a workout for you`,
  deepLink: "/sessions/s-1",
  relatedEntityType: "workout_session",
  relatedEntityId: "s-1",
};

describe("emitTrainerOnBehalfNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatch.mockResolvedValue(undefined);
  });

  it("resolves the coach display name and dispatches to the client with the deep link", async () => {
    (getDb as any).mockReturnValue(
      dbReturning([{ fullName: "Coach Bradley" }]),
    );

    await emitTrainerOnBehalfNotification(BASE);

    expect(dispatch).toHaveBeenCalledWith("client-1", {
      type: "workout_logged_on_behalf",
      title: "Workout logged by your coach",
      message: "Coach Bradley logged a workout for you",
      relatedEntityType: "workout_session",
      relatedEntityId: "s-1",
      data: { deepLink: "/sessions/s-1" },
    });
  });

  it("falls back to 'your coach' when the trainer has no full name", async () => {
    (getDb as any).mockReturnValue(dbReturning([{ fullName: null }]));
    await emitTrainerOnBehalfNotification(BASE);
    expect(dispatch).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        message: "your coach logged a workout for you",
      }),
    );
  });

  it("falls back when the trainer profile row is missing", async () => {
    (getDb as any).mockReturnValue(dbReturning([]));
    await emitTrainerOnBehalfNotification(BASE);
    expect(dispatch).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        message: "your coach logged a workout for you",
      }),
    );
  });

  it("never throws when dispatch fails (best-effort)", async () => {
    (getDb as any).mockReturnValue(dbReturning([{ fullName: "Coach B" }]));
    dispatch.mockRejectedValue(new Error("push down"));
    await expect(
      emitTrainerOnBehalfNotification(BASE),
    ).resolves.toBeUndefined();
  });

  it("never throws when the profile lookup itself fails", async () => {
    (getDb as any).mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(
      emitTrainerOnBehalfNotification(BASE),
    ).resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
