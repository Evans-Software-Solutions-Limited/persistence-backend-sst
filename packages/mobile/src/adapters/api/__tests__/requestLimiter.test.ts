import { MAX_IN_FLIGHT_REQUESTS, RequestLimiter } from "../requestLimiter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("RequestLimiter", () => {
  it("rejects a non-positive limit", () => {
    expect(() => new RequestLimiter(0)).toThrow();
    expect(() => new RequestLimiter(1.5)).toThrow();
    expect(MAX_IN_FLIGHT_REQUESTS).toBeGreaterThan(0);
  });

  it("runs at most `max` requests at a time and releases in FIFO order", async () => {
    const limiter = new RequestLimiter(2);
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];
    const results = gates.map((gate, i) =>
      limiter.run(() => {
        started.push(i);
        return gate.promise;
      }),
    );
    await settle();
    expect(started).toEqual([0, 1]);
    expect(limiter.inFlight).toBe(2);
    expect(limiter.queued).toBe(1);

    gates[0].resolve("a");
    await settle();
    expect(started).toEqual([0, 1, 2]);
    expect(limiter.queued).toBe(0);

    gates[1].resolve("b");
    gates[2].resolve("c");
    await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c"]);
    expect(limiter.inFlight).toBe(0);
  });

  it("releases the slot when the work rejects", async () => {
    const limiter = new RequestLimiter(1);
    await expect(
      limiter.run(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(limiter.inFlight).toBe(0);
    await expect(limiter.run(async () => 1)).resolves.toBe(1);
  });

  it("drops a waiting request whose signal aborts and keeps the queue intact", async () => {
    const limiter = new RequestLimiter(1);
    const gate = deferred<void>();
    const first = limiter.run(() => gate.promise);
    const controller = new AbortController();
    const aborted = limiter.run(async () => "never", controller.signal);
    const third = limiter.run(async () => "third");
    await settle();
    expect(limiter.queued).toBe(2);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(limiter.queued).toBe(1);
    gate.resolve();
    await first;
    await expect(third).resolves.toBe("third");
  });

  it("refuses to start work for an already aborted signal", async () => {
    const limiter = new RequestLimiter(1);
    const controller = new AbortController();
    controller.abort();
    const work = jest.fn(async () => 1);
    await expect(limiter.run(work, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(work).not.toHaveBeenCalled();
  });
});
