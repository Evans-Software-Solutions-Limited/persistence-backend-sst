import { act, renderHook } from "@testing-library/react-native";
import {
  useTogetherSharing,
  type TogetherSharingSource,
} from "../useTogetherSharing";
import type { SharingBase } from "@/ui/presenters/togetherSharing";

const people = [{ userId: "b", name: "Brad", tone: "info" as const }];
const none: SharingBase = { numbers: false, logging: false, previous: {} };
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const source = (
  over: Partial<TogetherSharingSource> = {},
): TogetherSharingSource => ({
  sessionId: "s1",
  people,
  base: none,
  write: jest.fn(async () => {}),
  ...over,
});

it("moves a switch on tap and holds it until the write settles", async () => {
  const write = deferred();
  let current = source({ write: jest.fn(() => write.promise) });
  const { result, rerender } = renderHook(() => useTogetherSharing(current));
  act(() => result.current.change({ key: "numbers", value: true }));
  expect(current.write).toHaveBeenCalledWith({ ...none, numbers: true }, none);
  expect(result.current.state?.numbers).toBe(true);
  // Acknowledged: the grants now say so.
  current = { ...current, base: { ...none, numbers: true } };
  rerender({});
  await act(async () => write.resolve());
  expect(result.current.state?.numbers).toBe(true);
  expect(result.current.state?.refused).toBeNull();
});

it("puts a refused switch back with one notice", async () => {
  const current = source({
    write: jest.fn(async () => {
      throw new Error("FORBIDDEN");
    }),
  });
  const { result } = renderHook(() => useTogetherSharing(current));
  await act(async () => result.current.change({ key: "logging", value: true }));
  expect(result.current.state?.logging).toBe(false);
  expect(result.current.state?.refused).toEqual({
    key: "logging",
    wanted: true,
  });
});

it("drops the notice once the sheet is dismissed, and a later refusal shows again (inspector lead)", async () => {
  const current = source({
    write: jest.fn(async () => {
      throw new Error("FORBIDDEN");
    }),
  });
  const { result } = renderHook(() => useTogetherSharing(current));
  await act(async () => result.current.change({ key: "logging", value: true }));
  expect(result.current.state?.refused).not.toBeNull();
  // Done: the switch is still off, but the notice has been seen.
  act(() => result.current.dismiss());
  expect(result.current.state?.logging).toBe(false);
  expect(result.current.state?.refused).toBeNull();
  await act(async () => result.current.change({ key: "numbers", value: true }));
  expect(result.current.state?.refused).toEqual({
    key: "numbers",
    wanted: true,
  });
});

it("shows no notice for a failed write that still holds, such as a queued offline change", async () => {
  let current = source({
    write: jest.fn(async () => {
      current = { ...current, base: { ...none, previous: { b: true } } };
      throw new Error("offline");
    }),
  });
  const { result } = renderHook(() => useTogetherSharing(current));
  await act(async () => result.current.change({ recipient: "b", value: true }));
  expect(result.current.state?.previous).toBe(true);
  expect(result.current.state?.refused).toBeNull();
});

it("only the latest change settles the switch, and another session starts clean", async () => {
  const first = deferred();
  const second = deferred();
  const writes = [first.promise, second.promise];
  let current = source({ write: jest.fn(() => writes.shift()!) });
  const { result, rerender } = renderHook(() => useTogetherSharing(current));
  act(() => result.current.change({ key: "numbers", value: true }));
  act(() => result.current.change({ key: "logging", value: true }));
  await act(async () => first.resolve());
  // The newer change is still in flight: both switches stay on.
  expect(result.current.state).toMatchObject({ numbers: true, logging: true });
  await act(async () => second.reject(new Error("FORBIDDEN")));
  expect(result.current.state?.refused?.key).toBe("logging");
  current = { ...current, sessionId: "s2" };
  rerender({});
  expect(result.current.state).toMatchObject({
    numbers: false,
    logging: false,
    refused: null,
  });
});

it("ignores writes that settle after unmount, and does nothing with no session", async () => {
  const write = deferred();
  const current = source({ write: jest.fn(() => write.promise) });
  const { result, unmount } = renderHook(() => useTogetherSharing(current));
  act(() => result.current.change({ key: "numbers", value: true }));
  unmount();
  await act(async () => write.reject(new Error("late")));
  const empty = renderHook(() => useTogetherSharing(null));
  expect(empty.result.current.state).toBeNull();
  expect(() =>
    empty.result.current.change({ key: "numbers", value: true }),
  ).not.toThrow();
});

it("a superseded write's failure raises no notice", async () => {
  const first = deferred();
  const writes = [first.promise, Promise.resolve()];
  const current = source({ write: jest.fn(() => writes.shift()!) });
  const { result } = renderHook(() => useTogetherSharing(current));
  act(() => result.current.change({ key: "previous", value: true }));
  await act(async () =>
    result.current.change({ key: "previous", value: false }),
  );
  // The first write fails after the second has undone it.
  await act(async () => first.reject(new Error("grant revoked")));
  expect(result.current.state?.refused).toBeNull();
});

it("a refusal still shows when the next tap was on another switch", async () => {
  const numbers = deferred();
  const writes = [numbers.promise, Promise.resolve()];
  const current = source({ write: jest.fn(() => writes.shift()!) });
  const { result } = renderHook(() => useTogetherSharing(current));
  act(() => result.current.change({ key: "numbers", value: true }));
  await act(async () => result.current.change({ key: "logging", value: true }));
  await act(async () => numbers.reject(new Error("FORBIDDEN")));
  // Fill-in went through; numbers went back, and says so.
  expect(result.current.state?.numbers).toBe(false);
  expect(result.current.state?.refused).toEqual({
    key: "numbers",
    wanted: true,
  });
});
