import { Share } from "react-native";
import {
  TogetherLog,
  shareTogetherLog,
  togetherLog,
  type TogetherLogEntry,
} from "../togetherLog";

const mockBreadcrumb = jest.fn();
let mockSentryOn = true;
jest.mock("@/lib/sentry", () => ({
  isSentryEnabled: () => mockSentryOn,
  Sentry: { addBreadcrumb: (...args: unknown[]) => mockBreadcrumb(...args) },
}));

beforeEach(() => {
  mockBreadcrumb.mockClear();
  mockSentryOn = true;
});

it("keeps the newest entries, drops undefined data and formats one line per entry", () => {
  let t = 1700000000000;
  const log = new TogetherLog(3, () => (t += 250));
  log.record("nearby", "startDiscovery ok", { ms: 12, code: undefined });
  log.record("lobby", "phase searching", {});
  log.record("nearby", "event discovered", { endpointId: "AB12" });
  log.record("nearby", "connect failed", {
    code: "connect_failed",
    message: "Nearby connection failed: x",
  });
  const entries = log.entries();
  expect(entries.map((e) => e.message)).toEqual([
    "phase searching",
    "event discovered",
    "connect failed",
  ]);
  expect(entries[0].data).toBeUndefined();
  expect(entries[1].data).toEqual({ endpointId: "AB12" });
  // Copies: mutating what callers get back never changes the log.
  entries[1].data!.endpointId = "tampered";
  expect(log.entries()[1].data).toEqual({ endpointId: "AB12" });
  const text = log.format();
  expect(text.split("\n")).toHaveLength(3);
  expect(text).toMatch(/\+ {6}0ms \[lobby\] phase searching$/m);
  expect(text).toMatch(
    /\+ {4}500ms \[nearby\] connect failed \{"code":"connect_failed","message":"Nearby connection failed: x"\}$/m,
  );
  expect(text.startsWith("2023-11-14T22:13:20.500Z")).toBe(true);
  log.clear();
  expect(log.entries()).toEqual([]);
  expect(log.format()).toBe("Together log is empty.");
});

it("notifies subscribers, survives failing listeners and sinks, and unsubscribes", () => {
  const seen: TogetherLogEntry[] = [];
  const log = new TogetherLog(
    10,
    () => 1,
    (entry) => {
      seen.push(entry);
      throw new Error("sink down");
    },
  );
  const listener = jest.fn(() => {
    throw new Error("render");
  });
  const quiet = jest.fn();
  const off = log.subscribe(listener);
  log.subscribe(quiet);
  log.record("lobby", "phase idle");
  expect(seen).toHaveLength(1);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(quiet).toHaveBeenCalledTimes(1);
  off();
  log.clear();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(quiet).toHaveBeenCalledTimes(2);
});

it("forwards the app-wide log to Sentry breadcrumbs only while Sentry is enabled", () => {
  togetherLog.record("nearby", "connect failed", { code: "connect_failed" });
  expect(mockBreadcrumb).toHaveBeenCalledWith({
    category: "together.nearby",
    message: "connect failed",
    level: "warning",
    data: { code: "connect_failed" },
  });
  togetherLog.record("lobby", "phase joined");
  expect(mockBreadcrumb).toHaveBeenLastCalledWith({
    category: "together.lobby",
    message: "phase joined",
    level: "info",
  });
  mockSentryOn = false;
  togetherLog.record("lobby", "phase idle");
  expect(mockBreadcrumb).toHaveBeenCalledTimes(2);
  togetherLog.clear();
});

it("strips identifiers and free text from breadcrumbs, keeping codes, phases, counts and timings", () => {
  togetherLog.record("lobby", "failure", {
    code: "Local sharing closed",
    message: "Device of sam@example.com not admitted",
    phase: "preparing",
    peerId: "0f5b2c1e-1111-4111-8111-111111111111",
    endpointId: "AB12",
    lobbyId: "c0ffee00-1111-4111-8111-111111111111",
    sessionId: "c0ffee00-1111-4111-8111-111111111111",
    invitationToken: "abc",
    ms: 120,
    ready: false,
    error: "token=abc/def",
  });
  expect(mockBreadcrumb).toHaveBeenCalledWith({
    category: "together.lobby",
    message: "failure",
    level: "warning",
    data: {
      code: "Local sharing closed",
      phase: "preparing",
      ms: 120,
      ready: false,
      error: "unrecognised",
    },
  });
  // Nothing safe left: no data at all.
  togetherLog.record("nearby", "event discovered", { endpointId: "AB12" });
  expect(mockBreadcrumb).toHaveBeenLastCalledWith({
    category: "together.nearby",
    message: "event discovered",
    level: "info",
  });
  togetherLog.clear();
});
it("shares the formatted log and tolerates a dismissed share sheet", async () => {
  const log = new TogetherLog(10, () => 5);
  log.record("lobby", "phase hosting");
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValueOnce({ action: Share.sharedAction });
  await shareTogetherLog(log);
  expect(share).toHaveBeenCalledWith({ message: log.format() });
  share.mockRejectedValueOnce(new Error("dismissed"));
  await expect(shareTogetherLog(log)).resolves.toBeUndefined();
  share.mockRestore();
});
