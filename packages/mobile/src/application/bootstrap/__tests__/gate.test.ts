import {
  BOOTSTRAP_WAIT_MS,
  beginBootstrap,
  bootstrapSettled,
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
    // The bounded wait adds one promise hop on top of the gate's own.
    await Promise.resolve();
    await Promise.resolve();
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
});
