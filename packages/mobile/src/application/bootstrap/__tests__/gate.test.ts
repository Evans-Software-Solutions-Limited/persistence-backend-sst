import {
  BOOTSTRAP_WAIT_MS,
  beginBootstrap,
  beginColdStart,
  bootstrapSettled,
  endColdStart,
  isBootstrapPending,
  subscribeBootstrapGate,
} from "../gate";

describe("bootstrap gate", () => {
  it("resolves at once when nothing is pending and waits while one is", async () => {
    await expect(bootstrapSettled("nobody")).resolves.toBeUndefined();
    await expect(bootstrapSettled(null)).resolves.toBeUndefined();
    const events: boolean[] = [];
    const unsubscribe = subscribeBootstrapGate(() =>
      events.push(isBootstrapPending("u1")),
    );
    const settle = beginBootstrap("u1");
    expect(isBootstrapPending("u1")).toBe(true);
    expect(beginBootstrap("u1")).toBe(settle);
    let done = false;
    void bootstrapSettled("u1").then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    settle();
    // The bounded wait adds promise hops on top of the gate's own.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(done).toBe(true);
    expect(isBootstrapPending("u1")).toBe(false);
    expect(events).toEqual([true, false]);
    settle();
    unsubscribe();
    expect(isBootstrapPending("u1")).toBe(false);
  });

  it("a stale settle cannot clear a newer pending bootstrap", () => {
    const first = beginBootstrap("u2");
    first();
    const second = beginBootstrap("u2");
    first();
    expect(isBootstrapPending("u2")).toBe(true);
    second();
    expect(isBootstrapPending("u2")).toBe(false);
  });

  it("never waits longer than the bound for a stalled bootstrap", async () => {
    jest.useFakeTimers();
    try {
      const settle = beginBootstrap("u-stalled");
      let done = false;
      void bootstrapSettled("u-stalled").then(() => {
        done = true;
      });
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_WAIT_MS - 1);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      settle();
    } finally {
      jest.useRealTimers();
    }
  });

  it("the cold-start flag holds every waiter, even without a user, until it ends", async () => {
    beginColdStart();
    beginColdStart();
    expect(isBootstrapPending(null)).toBe(true);
    expect(isBootstrapPending("anyone")).toBe(true);
    let anonymous = false;
    let user = false;
    void bootstrapSettled(null).then(() => {
      anonymous = true;
    });
    const settle = beginBootstrap("u-cold");
    void bootstrapSettled("u-cold").then(() => {
      user = true;
    });
    endColdStart();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(anonymous).toBe(true);
    expect(user).toBe(false);
    settle();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(user).toBe(true);
    expect(isBootstrapPending(null)).toBe(false);
    endColdStart();
  });
});
