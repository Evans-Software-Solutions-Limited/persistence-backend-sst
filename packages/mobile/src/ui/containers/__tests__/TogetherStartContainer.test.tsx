import React from "react";
import { act, fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherStartContainer, workoutMeta } from "../TogetherStartContainer";
import { useTogetherSettings } from "@/state/together-settings";
let mockUser: string | null = "u",
  mockAllowed = true,
  mockActive: any = null,
  mockPhase = "idle",
  mockWorkouts: any,
  mockParams: any = {},
  mockHome: any = { data: null },
  mockHasCloud = true;
const mockReplace = jest.fn(),
  mockPush = jest.fn(),
  mockBack = jest.fn(),
  mockStart = jest.fn();
const mockStorage = { getActiveSession: () => mockActive };
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    storage: mockStorage,
    togetherLobby: { getSnapshot: () => ({ phase: mockPhase }) },
    togetherCloud: mockHasCloud ? {} : undefined,
  }),
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockUser ? { userId: mockUser } : null }),
}));
jest.mock("@/ui/hooks/useTogetherGate", () => ({
  useTogetherGate: () => ({
    allowed: mockAllowed,
    state: mockAllowed ? "allowed" : "locked",
    onUpgrade: jest.fn(),
    retry: jest.fn(),
  }),
}));
jest.mock("@/ui/hooks/useWorkouts", () => ({
  useWorkouts: () => mockWorkouts,
}));
jest.mock("@/ui/hooks/useGetHome", () => ({ useGetHome: () => mockHome }));
jest.mock("expo-router", () => ({
  router: {
    replace: (...a: any[]) => mockReplace(...a),
    push: (...a: any[]) => mockPush(...a),
    back: (...a: any[]) => mockBack(...a),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "new-own" }));
jest.mock("@/application/commands/session", () => ({
  startSessionCommand: (...a: any[]) => mockStart(...a),
}));
const workout = (id: string, name: string, minutes = 50) => ({
  id,
  name,
  estimatedDurationMinutes: minutes,
  exercises: [
    { exerciseId: "bench" },
    { exerciseId: "row" },
    { exerciseId: "squat" },
  ],
});
beforeEach(() => {
  jest.clearAllMocks();
  useTogetherSettings.getState().reset();
  mockUser = "u";
  mockAllowed = true;
  mockActive = null;
  mockPhase = "idle";
  mockParams = {};
  mockHasCloud = true;
  mockHome = {
    data: { todaysTraining: [{ workoutId: "lower", name: "Lower Body B" }] },
  };
  mockWorkouts = {
    mine: {
      workouts: [
        workout("push", "Push A", 55),
        workout("lower", "Lower Body B"),
      ],
    },
    assigned: { workouts: [workout("push", "Push A", 55)] },
    default: {
      workouts: [
        { ...workout("loadout", "Loadout"), variationKind: "loadout" },
      ],
    },
    isRefreshing: false,
  };
  mockStart.mockReturnValue({
    ok: true,
    value: { id: "new-own", userId: "u" },
  });
});
it("picks a workout (today's programme first), asks mode and audience once, then starts with the presets", async () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  await act(async () => {});
  expect(r.getByText("Today in your programme")).toBeTruthy();
  expect(r.getAllByRole("radio", { name: "Choose Push A" })).toHaveLength(1);
  expect(r.queryByRole("radio", { name: "Choose Loadout" })).toBeNull();
  fireEvent.press(r.getByRole("radio", { name: "Choose Lower Body B" }));
  expect(r.getByText("Start a shared session")).toBeTruthy();
  expect(r.getByText("3 exercises · about 50 min")).toBeTruthy();
  // Presets from Together settings: Nearby and Training partners.
  expect(
    r.getByRole("radio", { name: "Nearby · no internet needed" }).props
      .accessibilityState.checked,
  ).toBe(true);
  expect(
    r.getByRole("radio", { name: "Training partners" }).props.accessibilityState
      .checked,
  ).toBe(true);
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "u" }),
    {
      workout: expect.objectContaining({ id: "lower" }),
    },
  );
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/(app)/session",
    params: {
      togetherAccountId: "u",
      togetherAudience: "friends",
      togetherConnection: "local",
    },
  });
});
it("Change returns to the picker, Back leaves it, and Online drops Open nearby to partners", async () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  await act(async () => {});
  fireEvent.press(r.getByRole("radio", { name: "Choose Push A" }));
  fireEvent.press(r.getByRole("radio", { name: "Open nearby" }));
  fireEvent.press(r.getByRole("radio", { name: "Online · internet required" }));
  expect(
    r.getByRole("radio", { name: "Open nearby" }).props.accessibilityState,
  ).toEqual({ checked: false, disabled: true });
  fireEvent.press(r.getByRole("radio", { name: "Private" }));
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockReplace).toHaveBeenLastCalledWith({
    pathname: "/(app)/session",
    params: {
      togetherAccountId: "u",
      togetherAudience: "invite-only",
      togetherConnection: "online",
    },
  });
  fireEvent.press(r.getByText("Change"));
  expect(r.getByText("Pick a workout")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Back"));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it("opens on the setup step with the workout from the detail page selected", async () => {
  mockParams = { workoutId: "push" };
  const r = renderWithTheme(<TogetherStartContainer />);
  await act(async () => {});
  expect(r.getByText("Start a shared session")).toBeTruthy();
  expect(r.getByText("Push A")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Back"));
  expect(mockBack).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockStart).toHaveBeenCalledWith(expect.anything(), {
    workout: expect.objectContaining({ id: "push" }),
  });
});
it("continues an open solo workout, keeping its logged sets, without creating another", async () => {
  mockActive = {
    id: "own",
    userId: "u",
    name: "Evening Squats",
    // Five planned rows, three completed: the planned empties are not "logged".
    exercises: [
      { sets: [{ isCompleted: true }, { isCompleted: true }, {}] },
      { sets: [{ isCompleted: true }, {}] },
    ],
  };
  const r = renderWithTheme(<TogetherStartContainer />);
  await act(async () => {});
  expect(r.getByText("Evening Squats")).toBeTruthy();
  expect(
    r.getByText("Your current workout · keeps your 3 logged sets"),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockStart).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith(
    expect.objectContaining({ pathname: "/(app)/session" }),
  );
  fireEvent.press(r.getByText("Change"));
  expect(mockBack).toHaveBeenCalled();
});
it("resumes a Together workout created meanwhile and refuses incompatible ones", async () => {
  mockParams = { workoutId: "push" };
  const r = renderWithTheme(<TogetherStartContainer />);
  await act(async () => {});
  mockActive = { together: { transport: "lan" } };
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockReplace).toHaveBeenCalledWith("/(app)/session");
  for (const field of ["withClient", "retrospectiveCompletedAt"]) {
    mockReplace.mockClear();
    mockActive = { [field]: true, exercises: [] };
    fireEvent.press(r.getByText("Start workout together"));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(r.getByText(/Could not start sharing/)).toBeTruthy();
  }
});
it("keeps a busy connection, a missing adapter or a failed start from replacing the workout", async () => {
  mockParams = { workoutId: "push" };
  const r = renderWithTheme(<TogetherStartContainer />);
  await act(async () => {});
  mockPhase = "hosting";
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockReplace).not.toHaveBeenCalled();
  mockPhase = "idle";
  mockStart.mockReturnValueOnce({ ok: false, error: "x" });
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockReplace).not.toHaveBeenCalled();
  mockHasCloud = false;
  r.rerender(<TogetherStartContainer />);
  expect(
    r.queryByRole("radio", { name: "Online · internet required" }),
  ).toBeNull();
});
it("offers workout creation only when the library is empty", async () => {
  mockHome = { data: null };
  mockWorkouts = {
    mine: { workouts: [] },
    assigned: { workouts: [] },
    default: { workouts: [] },
    isRefreshing: false,
  };
  const r = renderWithTheme(<TogetherStartContainer />);
  await act(async () => {});
  fireEvent.press(r.getByText("Create a workout"));
  expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/create");
});
it("does not allow unpaid or signed-out starts", async () => {
  mockAllowed = false;
  const r = renderWithTheme(<TogetherStartContainer />);
  expect(r.getByText(/qualifying paid subscription/)).toBeTruthy();
  fireEvent.press(r.getByText("Back"));
  expect(mockBack).toHaveBeenCalled();
  mockAllowed = true;
  mockUser = null;
  mockParams = { workoutId: "push" };
  r.rerender(<TogetherStartContainer />);
  await act(async () => {});
  fireEvent.press(r.getByText("Start workout together"));
  expect(mockReplace).not.toHaveBeenCalled();
});
it("workoutMeta reads naturally for one exercise and without a duration", () => {
  expect(workoutMeta(1, 30)).toBe("1 exercise · about 30 min");
  expect(workoutMeta(4, null)).toBe("4 exercises");
  expect(workoutMeta(2, 0)).toBe("2 exercises");
});
