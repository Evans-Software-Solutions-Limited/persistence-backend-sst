/** @jest-environment node */
import type {
  TogetherLanEvent,
  TogetherLanNative,
} from "../../../../modules/together-lan";
import { withNativeDiagnostics } from "../nativeDiagnostics";
import { togetherErrorCode, togetherErrorMessage } from "../errorCode";

function raw() {
  let listener: ((event: TogetherLanEvent) => void) | undefined;
  const native: TogetherLanNative & {
    emit(event: TogetherLanEvent): void;
  } = {
    startHost: jest.fn(async () => {}),
    startDiscovery: jest.fn(async () => {}),
    connect: jest.fn(async () => {}),
    send: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    addListener: jest.fn((_name, next) => {
      listener = next;
      return { remove: jest.fn() };
    }),
    emit: (event) => listener?.(event),
  };
  return native;
}
const expoRejection = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

it("reads Expo's native code before the human message", () => {
  expect(
    togetherErrorCode(
      expoRejection("connect_failed", "Nearby connection failed"),
    ),
  ).toBe("connect_failed");
  expect(togetherErrorCode(new Error("host_unreachable"))).toBe(
    "host_unreachable",
  );
  expect(togetherErrorCode(Object.assign(new Error("m"), { code: 7 }))).toBe(
    "m",
  );
  expect(togetherErrorCode(new Error(""))).toBe("unavailable");
  expect(togetherErrorCode("expired")).toBe("unavailable");
  expect(togetherErrorCode(undefined, "stop-failed")).toBe("stop-failed");
  expect(togetherErrorCode(42)).toBe("unavailable");
  expect(togetherErrorMessage(new Error("why"))).toBe("why");
  expect(togetherErrorMessage(new Error(""))).toBeUndefined();
  expect(togetherErrorMessage("text")).toBe("text");
  expect(togetherErrorMessage({})).toBeUndefined();
});

it("records calls with duration and real codes, keeps successful sends quiet and forwards results", async () => {
  const native = raw();
  const record = jest.fn();
  let t = 0;
  const wrapped = withNativeDiagnostics(native, { record }, "nearby", () => {
    t += 10;
    return t;
  });
  await wrapped.startHost("lobby-1");
  await wrapped.startDiscovery();
  await wrapped.send("peer", "frame");
  await wrapped.disconnect("peer");
  await wrapped.stop();
  jest
    .mocked(native.connect)
    .mockRejectedValueOnce(
      expoRejection("connect_failed", "Nearby connection failed: BLE"),
    );
  await expect(wrapped.connect("AB12")).rejects.toThrow("BLE");
  jest.mocked(native.send).mockRejectedValueOnce(new Error("send_failed"));
  await expect(wrapped.send("peer", "xyz")).rejects.toThrow("send_failed");
  expect(record.mock.calls).toEqual([
    ["nearby", "startHost ok", { lobbyId: "lobby-1", ms: 10 }],
    ["nearby", "startDiscovery ok", { ms: 10 }],
    ["nearby", "disconnect ok", { peerId: "peer", ms: 10 }],
    ["nearby", "stop ok", { ms: 10 }],
    [
      "nearby",
      "connect failed",
      {
        endpointId: "AB12",
        ms: 10,
        code: "connect_failed",
        message: "Nearby connection failed: BLE",
      },
    ],
    [
      "nearby",
      "send failed",
      {
        peerId: "peer",
        chars: 3,
        ms: 10,
        code: "send_failed",
        message: "send_failed",
      },
    ],
  ]);
  expect(native.startHost).toHaveBeenCalledWith("lobby-1");
  expect(native.connect).toHaveBeenCalledWith("AB12");
  expect(native.send).toHaveBeenCalledWith("peer", "frame");
});

it("records every event except frame contents and keeps SDK log events out of the session", () => {
  const native = raw();
  const record = jest.fn();
  const listener = jest.fn();
  const wrapped = withNativeDiagnostics(native, { record }, "lan");
  const sub = wrapped.addListener("onEvent", listener);
  native.emit({ type: "discovered", endpointId: "E1", lobbyId: "L" });
  native.emit({ type: "frame", peerId: "p", frame: "secret payload" });
  native.emit({
    type: "log",
    message: "requestConnection failed",
    data: { error: "Timed out", errorCode: 7 },
  });
  native.emit({ type: "log", message: "didLose" });
  native.emit({ type: "error", code: "read_timeout", peerId: "p" });
  expect(record.mock.calls).toEqual([
    ["lan", "event discovered", { endpointId: "E1", lobbyId: "L" }],
    ["lan", "requestConnection failed", { error: "Timed out", errorCode: 7 }],
    ["lan", "didLose", undefined],
    ["lan", "event error", { code: "read_timeout", peerId: "p" }],
  ]);
  expect(listener.mock.calls.map(([e]) => e.type)).toEqual([
    "discovered",
    "frame",
    "error",
  ]);
  expect(JSON.stringify(record.mock.calls)).not.toContain("secret payload");
  expect(sub.remove).toBeDefined();
});
