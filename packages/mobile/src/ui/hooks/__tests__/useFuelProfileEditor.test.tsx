import { act, renderHook } from "@testing-library/react-native";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { useFuelProfileEditor } from "../useFuelProfileEditor";
import type { ProfilePageData } from "@/domain/models/profilePage";
import { localDayISO } from "@/shared/utils";

let mockStorage: InMemoryStorageAdapter;
let mockSession: { userId: string } | null = { userId: "user-1" };
jest.mock("../useAdapters", () => ({
  useAdapters: () => ({ storage: mockStorage, auth: {} }),
}));
jest.mock("../useAuth", () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock("@/adapters/api", () => ({
  getApiBaseUrl: () => "https://example.test",
}));
jest.mock("@/application/commands/sync.command", () => ({
  processSyncQueue: jest.fn(async () => {
    throw new Error("offline");
  }),
}));

const profile = {
  dateOfBirth: "1990-01-01",
  gender: "male" as const,
  heightCm: 178,
  heightUnit: "cm" as const,
  weightUnit: "kg" as const,
};
const init = (overrides = {}) =>
  renderHook(() => useFuelProfileEditor({ ...profile, ...overrides }, 80));

beforeEach(() => {
  mockStorage = new InMemoryStorageAdapter();
  mockSession = { userId: "user-1" };
  mockStorage.cacheProfilePage("user-1", {
    profile: { ...profile, id: "user-1" },
  } as ProfilePageData);
});

it("saves DOB into the offline profile cache and queue, immediately updating age's source", async () => {
  const { result } = init();
  act(() => result.current.open("age"));
  expect(result.current.editor?.value).toBe("1990-01-01");
  act(() => result.current.change("1995-04-12"));
  await act(async () => result.current.save());
  expect(result.current.profile?.dateOfBirth).toBe("1995-04-12");
  expect(result.current.editor).toBeNull();
  expect(
    mockStorage.getCachedProfilePage("user-1")?.payload.profile.dateOfBirth,
  ).toBe("1995-04-12");
  expect(JSON.parse(mockStorage.getUncompletedMutations()[0].payload)).toEqual({
    dateOfBirth: "1995-04-12",
  });
});

it.each(["", "bad", "2000-02-30", "2999-01-01", localDayISO()])(
  "rejects DOB %s before queueing",
  (value) => {
    const { result } = init();
    act(() => result.current.open("age"));
    act(() => result.current.change(value));
    act(() => result.current.save());
    expect(result.current.editor?.error).toMatch(/date of birth/);
    expect(mockStorage.getUncompletedMutations()).toHaveLength(0);
  },
);

it.each(["male", "female", "other"])(
  "persists %s without resetting other accepted changes",
  async (value) => {
    const { result } = init({ gender: null });
    act(() => result.current.open("height"));
    act(() => result.current.change("180"));
    await act(async () => result.current.save());
    act(() => result.current.open("gender"));
    expect(result.current.editor?.value).toBe("");
    act(() => result.current.change(value));
    await act(async () => result.current.save());
    expect(result.current.profile).toMatchObject({
      gender: value,
      heightCm: 180,
    });
    expect(
      JSON.parse(mockStorage.getUncompletedMutations()[0].payload),
    ).toEqual({ gender: value, heightCm: 180 });
  },
);

it("rejects an unselected sex and lets cancellation discard the input", () => {
  const { result } = init({ gender: null });
  act(() => result.current.open("gender"));
  act(() => result.current.save());
  expect(result.current.editor?.error).toMatch(/Choose a sex/);
  act(() => result.current.change("female"));
  expect(result.current.editor?.error).toBeNull();
  act(() => result.current.close());
  expect(result.current.profile?.gender).toBeNull();
  expect(mockStorage.getUncompletedMutations()).toHaveLength(0);
});

it.each(["", "NaN", "Infinity", "0", "-1", "40", "300"])(
  "rejects invalid height %s",
  (value) => {
    const { result } = init();
    act(() => result.current.open("height"));
    act(() => result.current.change(value));
    act(() => result.current.save());
    expect(result.current.editor?.error).toBeTruthy();
    expect(mockStorage.getUncompletedMutations()).toHaveLength(0);
  },
);

it("converts feet/inches to centimetres and pre-fills in profile units", async () => {
  const { result } = init({ heightUnit: "ftin" });
  act(() => result.current.open("height"));
  expect(result.current.editor).toMatchObject({ value: "5", inches: "10" });
  act(() => result.current.change("6"));
  act(() => result.current.change("1", true));
  await act(async () => result.current.save());
  expect(result.current.profile?.heightCm).toBeCloseTo(185.42);
});

it.each([
  ["5.5", "0"],
  ["5", "12"],
  ["5", "-1"],
  ["5", "NaN"],
  ["5", ""],
])("rejects invalid imperial height %s/%s", (feet, inches) => {
  const { result } = init({ heightUnit: "ftin" });
  act(() => result.current.open("height"));
  act(() => result.current.change(feet));
  act(() => result.current.change(inches, true));
  act(() => result.current.save());
  expect(result.current.editor?.error).toMatch(/whole feet/);
  expect(mockStorage.getUncompletedMutations()).toHaveLength(0);
});

it.each(["kg", "lb"] as const)(
  "logs today's weight in %s through the measurement queue",
  async (weightUnit) => {
    const { result } = init({ weightUnit });
    act(() => result.current.open("weight"));
    expect(result.current.editor?.value).toBe(
      weightUnit === "kg" ? "80" : "176.4",
    );
    act(() => result.current.change("100"));
    await act(async () => result.current.save());
    const expected = weightUnit === "kg" ? 100 : 45.359237;
    expect(result.current.weightKg).toBeCloseTo(expected);
    expect(mockStorage.getCachedBodyTrend("user-1")[0].weightKg).toBeCloseTo(
      expected,
    );
    expect(mockStorage.getUncompletedMutations()[0]).toMatchObject({
      endpoint: "/measurements",
      entityId: localDayISO(),
    });
  },
);

it("rejects out-of-range weight without an optimistic update", () => {
  const { result } = init();
  act(() => result.current.open("weight"));
  act(() => result.current.change("1000"));
  act(() => result.current.save());
  expect(result.current.editor?.error).toMatch(/realistic weight/);
  expect(result.current.weightKg).toBe(80);
});

it("handles missing profile fields, unavailable profile and no session", () => {
  const { result, rerender } = renderHook(
    ({ available }) =>
      useFuelProfileEditor(
        available ? { ...profile, dateOfBirth: null, heightCm: null } : null,
        null,
      ),
    { initialProps: { available: true } },
  );
  for (const field of ["age", "height", "weight"] as const) {
    act(() => result.current.open(field));
    expect(result.current.editor?.value).toBe("");
  }
  rerender({ available: false });
  act(() => result.current.save());
  expect(result.current.editor?.error).toMatch(/profile is still loading/);
  mockSession = null;
  rerender({ available: true });
  act(() => result.current.save());
  expect(mockStorage.getUncompletedMutations()).toHaveLength(0);
});

it("retains form input on storage failure", () => {
  const { result } = init();
  jest.spyOn(mockStorage, "enqueueMutation").mockImplementation(() => {
    throw new Error("disk");
  });
  act(() => result.current.open("weight"));
  act(() => result.current.change("75"));
  act(() => result.current.save());
  expect(result.current.editor).toMatchObject({
    value: "75",
    error: "Couldn't save your details. Please try again.",
  });
});

it("does not apply one account's accepted edits to another", async () => {
  const { result, rerender } = init();
  act(() => result.current.open("height"));
  act(() => result.current.change("180"));
  await act(async () => result.current.save());
  mockSession = { userId: "user-2" };
  rerender({});
  expect(result.current.profile?.heightCm).toBe(178);
  act(() => result.current.close());
  act(() => result.current.change("unused"));
  act(() => result.current.save());
  expect(result.current.editor).toBeNull();
});
