/** @jest-environment node */
import { frameNearby } from "../framing";
import type { TogetherLanEvent, TogetherLanNative } from "../../together-lan";
function setup() {
  let receive: (e: TogetherLanEvent) => void = () => {};
  const raw: TogetherLanNative = {
    startHost: jest.fn(async () => {}),
    startDiscovery: jest.fn(async () => {}),
    connect: jest.fn(async () => {}),
    send: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    addListener: jest.fn((_, fn) => {
      receive = fn;
      return { remove: jest.fn() };
    }),
  };
  const adapter = frameNearby(raw),
    listener = jest.fn();
  const sub = adapter.addListener("onEvent", listener);
  return {
    raw,
    adapter,
    listener,
    sub,
    emit: (event: TogetherLanEvent) => receive(event),
  };
}
const packet = (data: string, index = 0, total = 1) =>
  JSON.stringify({ v: 1, index, total, data });
const incoming = (frame: string, peerId = "peer"): TogetherLanEvent => ({
  type: "frame",
  peerId,
  frame,
});
afterEach(() => jest.useRealTimers());
it("round-trips a64KB unicode frame through bounded packets and serializes concurrent sends", async () => {
  const s = setup();
  const wire = "😀".repeat(16384);
  await Promise.all([
    s.adapter.send("peer", wire),
    s.adapter.send("peer", "next"),
  ]);
  const packets = jest.mocked(s.raw.send).mock.calls.map(([, frame]) => frame);
  expect(packets.length).toBeGreaterThan(1);
  for (const p of packets) {
    expect(new TextEncoder().encode(p).length).toBeLessThan(32768);
    s.emit(incoming(p));
  }
  expect(s.listener.mock.calls.map(([e]) => e.frame)).toEqual([wire, "next"]);
  await s.adapter.stop();
});
it("forwards only fully assembled frames and preserves control events", () => {
  const s = setup();
  s.emit(incoming(packet("a", 0, 2)));
  expect(s.listener).not.toHaveBeenCalled();
  s.emit(incoming(packet("b", 1, 2)));
  expect(s.listener).toHaveBeenCalledWith(incoming("ab"));
  s.emit({ type: "lost", endpointId: "one" });
  expect(s.listener).toHaveBeenLastCalledWith({
    type: "lost",
    endpointId: "one",
  });
  s.sub.remove();
});
it.each([
  "not-json",
  "null",
  packet("", 0, 1),
  packet("x", 1, 1),
  packet("x", 0, 17),
  JSON.stringify({ v: 1, index: 0, total: 1, data: "x", extra: true }),
  "x".repeat(32769),
])("rejects malformed packet %#", (wire) => {
  const s = setup();
  s.emit(incoming(wire));
  expect(s.listener).toHaveBeenCalledWith({
    type: "error",
    code: "invalid_frame",
    peerId: "peer",
  });
  expect(s.raw.disconnect).toHaveBeenCalledWith("peer");
});
it("rejects conflicting continuation, excessive byte count, and ninth partial peer", () => {
  const s = setup();
  s.emit(incoming(packet("a", 0, 2)));
  s.emit(incoming(packet("b", 1, 3)));
  expect(s.raw.disconnect).toHaveBeenCalledWith("peer");
  for (let i = 0; i < 9; i++)
    s.emit(incoming(packet("😀".repeat(2048), i, 9), "too-large"));
  expect(s.raw.disconnect).toHaveBeenCalledWith("too-large");
  for (let i = 0; i < 9; i++)
    s.emit(incoming(packet("x", 0, 2), `partial-${i}`));
  expect(s.raw.disconnect).toHaveBeenCalledWith("partial-8");
  s.sub.remove();
});
it("times out partial frames and cancels timers on disconnect/remove/stop", async () => {
  jest.useFakeTimers();
  const s = setup();
  s.emit(incoming(packet("a", 0, 2)));
  jest.advanceTimersByTime(10000);
  expect(s.raw.disconnect).toHaveBeenCalledWith("peer");
  s.emit(incoming(packet("b", 0, 2)));
  s.emit({ type: "disconnected", peerId: "peer" });
  expect(jest.getTimerCount()).toBe(0);
  s.emit(incoming(packet("c", 0, 2)));
  await s.adapter.stop();
  expect(jest.getTimerCount()).toBe(0);
  const calls = s.listener.mock.calls.length;
  s.emit(incoming(packet("late")));
  expect(s.listener).toHaveBeenCalledTimes(calls);
});
it("bounds writes and cancels queued frames without stale disconnect into a new generation", async () => {
  const s = setup();
  let reject!: (e: Error) => void;
  jest.mocked(s.raw.send).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const writes = Array.from({ length: 16 }, () =>
    s.adapter.send("peer", "x").catch((e) => e),
  );
  await expect(s.adapter.send("peer", "extra")).rejects.toThrow(
    "frame_queue_full",
  );
  await Promise.resolve();
  await s.adapter.stop();
  reject(new Error("old failure"));
  await Promise.all(writes);
  expect(s.raw.disconnect).not.toHaveBeenCalled();
  await expect(s.adapter.send("peer", "")).rejects.toThrow("frame_limit");
  await expect(s.adapter.send("peer", "x".repeat(65537))).rejects.toThrow(
    "frame_limit",
  );
});
it("forwards explicit lifecycle and disconnects current failed sends", async () => {
  const s = setup();
  await s.adapter.startHost("lobby");
  await s.adapter.startDiscovery();
  await s.adapter.connect("one");
  expect(s.raw.startHost).toHaveBeenCalledWith("lobby");
  expect(s.raw.connect).toHaveBeenCalledWith("one");
  jest.mocked(s.raw.send).mockRejectedValueOnce(new Error("failure"));
  await expect(s.adapter.send("peer", "x")).rejects.toThrow("failure");
  await Promise.resolve();
  expect(s.raw.disconnect).toHaveBeenCalledWith("peer");
  await s.adapter.disconnect("other");
  expect(s.raw.disconnect).toHaveBeenCalledWith("other");
});
it("retains the original protocol failure when native disconnect also fails", async () => {
  const s = setup();
  jest.mocked(s.raw.disconnect).mockRejectedValue(new Error("radio gone"));
  s.emit(incoming("invalid"));
  await Promise.resolve();
  expect(s.listener).toHaveBeenCalledWith({
    type: "error",
    peerId: "peer",
    code: "invalid_frame",
  });
  jest.mocked(s.raw.send).mockRejectedValue(new Error("write failed"));
  await expect(s.adapter.send("peer", "x")).rejects.toThrow("write failed");
  await Promise.resolve();
  await Promise.resolve();
  expect(s.raw.disconnect).toHaveBeenCalledTimes(2);
});
