import { REQUEST_LOG_CAPACITY, RequestLog } from "../requestLog";

describe("RequestLog", () => {
  it("records start, end, status and errors oldest first, and copies entries", () => {
    let t = 1_000;
    const log = new RequestLog(10, () => t);
    const a = log.start("GET", "/a");
    t = 1_010;
    log.end(a, 200);
    const b = log.start("POST", "/b");
    t = 1_030;
    log.end(b, null, new Error("boom"));
    const c = log.start("GET", "/c");
    const abort = new Error("x");
    abort.name = "AbortError";
    log.end(c, null, abort);
    log.end(999, 200);
    const entries = log.entries();
    expect(entries).toEqual([
      {
        id: a,
        method: "GET",
        path: "/a",
        startedAt: 1_000,
        endedAt: 1_010,
        status: 200,
        error: null,
      },
      {
        id: b,
        method: "POST",
        path: "/b",
        startedAt: 1_010,
        endedAt: 1_030,
        status: null,
        error: "boom",
      },
      {
        id: c,
        method: "GET",
        path: "/c",
        startedAt: 1_030,
        endedAt: 1_030,
        status: null,
        error: "aborted",
      },
    ]);
    entries[0].path = "mutated";
    expect(log.entries()[0].path).toBe("/a");
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it("keeps only the newest entries", () => {
    const log = new RequestLog(2);
    log.start("GET", "/1");
    log.start("GET", "/2");
    log.start("GET", "/3");
    expect(log.entries().map((e) => e.path)).toEqual(["/2", "/3"]);
    expect(REQUEST_LOG_CAPACITY).toBeGreaterThan(2);
  });

  it("track records the response status or the thrown error", async () => {
    const log = new RequestLog();
    await expect(
      log.track("GET", "/ok", async () => ({ status: 204 })),
    ).resolves.toEqual({ status: 204 });
    await expect(
      log.track("GET", "/bad", async () => {
        throw "offline";
      }),
    ).rejects.toBe("offline");
    expect(log.entries().map((e) => [e.path, e.status, e.error])).toEqual([
      ["/ok", 204, null],
      ["/bad", null, "offline"],
    ]);
  });
});
