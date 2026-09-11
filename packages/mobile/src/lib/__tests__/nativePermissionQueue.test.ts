import { AppState, Platform, type AppStateStatus } from "react-native";
import { runNativePermissionRequest } from "../nativePermissionQueue";

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
let listeners: Set<() => void>;
function setState(state: AppStateStatus) {
  AppState.currentState = state;
  for (const listener of listeners) listener();
}
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  AppState.currentState = "active";
  listeners = new Set();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    const callback = listener as () => void;
    listeners.add(callback);
    return { remove: () => listeners.delete(callback) };
  });
});
afterEach(() => {
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  jest.restoreAllMocks();
  jest.useRealTimers();
});
it("requires 300ms continuously active, restarting after inactive", async () => {
  const request = jest.fn(async () => "allowed");
  const result = runNativePermissionRequest(request);
  await jest.advanceTimersByTimeAsync(200);
  setState("inactive");
  await jest.advanceTimersByTimeAsync(500);
  expect(request).not.toHaveBeenCalled();
  setState("active");
  await jest.advanceTimersByTimeAsync(299);
  expect(request).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBe("allowed");
});
it("waits indefinitely in background until active", async () => {
  setState("background");
  const request = jest.fn(async () => true);
  const result = runNativePermissionRequest(request);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(request).not.toHaveBeenCalled();
  setState("active");
  await jest.advanceTimersByTimeAsync(300);
  await expect(result).resolves.toBe(true);
});
it("serializes operations and stabilizes after each settles", async () => {
  const first = deferred();
  const request = jest.fn(async () => "second");
  const firstResult = runNativePermissionRequest(() => first.promise);
  const secondResult = runNativePermissionRequest(request);
  await jest.advanceTimersByTimeAsync(1000);
  expect(request).not.toHaveBeenCalled();
  first.resolve("first");
  await expect(firstResult).resolves.toBe("first");
  await jest.advanceTimersByTimeAsync(299);
  expect(request).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await expect(secondResult).resolves.toBe("second");
});
it("continues after native rejection", async () => {
  const failure = runNativePermissionRequest(async () => {
    throw new Error("native failed");
  });
  const rejected = expect(failure).rejects.toThrow("native failed");
  const next = runNativePermissionRequest(async () => "next");
  await jest.advanceTimersByTimeAsync(600);
  await rejected;
  await expect(next).resolves.toBe("next");
});
it("rejects already-aborted requests without invoking", async () => {
  const controller = new AbortController();
  controller.abort();
  const request = jest.fn(async () => true);
  await expect(
    runNativePermissionRequest(request, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(request).not.toHaveBeenCalled();
});
it("aborts queued requests promptly without invoking later or poisoning the queue", async () => {
  const first = deferred();
  const firstResult = runNativePermissionRequest(() => first.promise);
  const controller = new AbortController();
  const request = jest.fn(async () => true);
  const queued = runNativePermissionRequest(request, controller.signal);
  const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
  await jest.advanceTimersByTimeAsync(300);
  controller.abort();
  await rejected;
  first.resolve("first");
  await firstResult;
  const next = runNativePermissionRequest(async () => "next");
  await jest.advanceTimersByTimeAsync(300);
  await expect(next).resolves.toBe("next");
  expect(request).not.toHaveBeenCalled();
});
it.each(["active", "background"] as const)(
  "cleans listeners and timers when aborted while waiting in %s",
  async (state) => {
    setState(state);
    const controller = new AbortController();
    const request = jest.fn(async () => true);
    const waiting = runNativePermissionRequest(request, controller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({
      name: "AbortError",
    });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await jest.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
  },
);
it("holds the queue until an in-flight operation settles after abort", async () => {
  const native = deferred();
  const controller = new AbortController();
  const current = runNativePermissionRequest(
    () => native.promise,
    controller.signal,
  );
  const rejected = expect(current).rejects.toMatchObject({
    name: "AbortError",
  });
  const request = jest.fn(async () => "next");
  const next = runNativePermissionRequest(request);
  await jest.advanceTimersByTimeAsync(300);
  controller.abort();
  await rejected;
  await jest.advanceTimersByTimeAsync(1000);
  expect(request).not.toHaveBeenCalled();
  native.resolve("first");
  await jest.advanceTimersByTimeAsync(300);
  await expect(next).resolves.toBe("next");
});
it("runs Android requests immediately without lifecycle waits or serialization", async () => {
  Object.defineProperty(Platform, "OS", {
    value: "android",
    configurable: true,
  });
  setState("background");
  const native = deferred();
  const first = runNativePermissionRequest(() => native.promise);
  const request = jest.fn(async () => "next");
  await expect(runNativePermissionRequest(request)).resolves.toBe("next");
  expect(request).toHaveBeenCalledTimes(1);
  native.resolve("first");
  await first;
});
it("converts synchronous Android errors to rejected promises", async () => {
  Object.defineProperty(Platform, "OS", {
    value: "android",
    configurable: true,
  });
  await expect(
    runNativePermissionRequest(() => {
      throw new Error("native failed");
    }),
  ).rejects.toThrow("native failed");
});

it("does not invoke when aborted just after stabilization finishes", async () => {
  const controller = new AbortController();
  const request = jest.fn(async () => true);
  const result = runNativePermissionRequest(request, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await jest.advanceTimersByTimeAsync(0);
  jest.advanceTimersByTime(300);
  controller.abort();
  await rejected;
  await jest.advanceTimersByTimeAsync(0);
  expect(request).not.toHaveBeenCalled();
});
