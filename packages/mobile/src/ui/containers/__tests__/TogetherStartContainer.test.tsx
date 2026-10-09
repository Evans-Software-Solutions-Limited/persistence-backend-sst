import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherStartContainer } from "../TogetherStartContainer";
let mockUser: string | null = "u",
  mockAllowed = true,
  mockActive: any = null,
  mockPhase = "idle",
  mockWorkouts: any;
const mockReplace = jest.fn(),
  mockPush = jest.fn(),
  mockBack = jest.fn(),
  mockSelect = jest.fn(),
  mockStart = jest.fn();
const mockStorage = { getActiveSession: () => mockActive };
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    storage: mockStorage,
    togetherLobby: {
      getSnapshot: () => ({ phase: mockPhase }),
      transports: ["lan", "nearby", "hotspot-owner"],
      selectTransport: (...a: any[]) => mockSelect(...a),
    },
    togetherCloud: {},
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
jest.mock("expo-router", () => ({
  router: {
    replace: (...a: any[]) => mockReplace(...a),
    push: (...a: any[]) => mockPush(...a),
    back: (...a: any[]) => mockBack(...a),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "new-own" }));
jest.mock("@/application/commands/session", () => ({
  startSessionCommand: (...a: any[]) => mockStart(...a),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = "u";
  mockAllowed = true;
  mockActive = null;
  mockPhase = "idle";
  const workout = {
    id: "push",
    name: "Push",
    exercises: [{ exerciseId: "bench" }],
  };
  mockWorkouts = {
    mine: { workouts: [workout] },
    assigned: { workouts: [workout] },
    default: { workouts: [] },
    isRefreshing: false,
  };
  mockStart.mockReturnValue({
    ok: true,
    value: { id: "new-own", userId: "u" },
  });
});
const guide = (r: any) => {
  fireEvent.press(r.getByLabelText("Choose Push"));
  fireEvent.press(r.getByText("Next · choose connection"));
};
it("requires three deliberate steps before starting the selected workout", () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  expect(r.getAllByLabelText("Choose Push")).toHaveLength(1);
  expect(mockStart).not.toHaveBeenCalled();
  guide(r);
  expect(mockStart).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockSelect).toHaveBeenCalledWith("lan");
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({ storage: mockStorage, userId: "u" }),
    { workout: mockWorkouts.mine.workouts[0] },
  );
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/(app)/session",
    params: {
      togetherAccountId: "u",
      togetherAudience: "open",
      togetherConnection: "local",
    },
  });
});
it("preserves current logged sets while starting sharing", () => {
  mockActive = {
    id: "own",
    name: "Existing",
    exercises: [{ sets: [{ completed: true }] }],
  };
  const r = renderWithTheme(<TogetherStartContainer />);
  fireEvent.press(r.getByText("Use my current workout"));
  fireEvent.press(r.getByText("Next · choose connection"));
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockStart).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalled();
  expect(mockActive.exercises[0].sets).toHaveLength(1);
});
it.each(["withClient", "retrospectiveCompletedAt"])(
  "preserves incompatible %s workouts",
  (flag) => {
    const r = renderWithTheme(<TogetherStartContainer />);
    guide(r);
    mockActive = { id: "own", [flag]: true };
    fireEvent.press(r.getByText("Start Together session"));
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(r.getByText(/Could not start sharing/)).toBeTruthy();
  },
);
it("resumes a Together workout created during selection", () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  guide(r);
  mockActive = { id: "own", together: { transport: "lan" } };
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockReplace).toHaveBeenCalledWith("/(app)/session");
  expect(mockStart).not.toHaveBeenCalled();
});
it("keeps a connection already in use and reports start failures", () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  guide(r);
  mockPhase = "hosting";
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockStart).not.toHaveBeenCalled();
  mockPhase = "idle";
  mockStart.mockReturnValue({ ok: false });
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockReplace).not.toHaveBeenCalled();
});
it("offers workout creation only when the library is empty and resets selection on account change", () => {
  mockWorkouts.mine.workouts = [];
  mockWorkouts.assigned.workouts = [];
  const r = renderWithTheme(<TogetherStartContainer />);
  fireEvent.press(r.getByText("Create a workout"));
  expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/create");
  mockUser = "other";
  r.rerender(<TogetherStartContainer />);
  expect(r.getByText("STEP 1 OF 3")).toBeTruthy();
});
it("does not allow unpaid or signed-out starts", () => {
  mockAllowed = false;
  const r = renderWithTheme(<TogetherStartContainer />);
  expect(r.queryByLabelText("Choose Push")).toBeNull();
  mockAllowed = true;
  mockUser = null;
  r.rerender(<TogetherStartContainer />);
  guide(r);
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockStart).not.toHaveBeenCalled();
});
it("allows deliberate connection selection and navigation back through the guide", () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  guide(r);
  fireEvent.press(r.getByText("Nearby phones"));
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockSelect).toHaveBeenCalledWith("nearby");
  fireEvent.press(r.getByText("Back"));
  expect(r.getByText("Who can join?")).toBeTruthy();
  fireEvent.press(r.getByText("Back"));
  fireEvent.press(r.getByText("Back"));
  expect(mockBack).toHaveBeenCalled();
});
it("starts an online partner session only after choosing partners and the online connection", () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  fireEvent.press(r.getByLabelText("Choose Push"));
  fireEvent.press(r.getByText("Training partners"));
  fireEvent.press(r.getByText("Next · choose connection"));
  fireEvent.press(r.getByText("Online · internet required"));
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/(app)/session",
    params: {
      togetherAccountId: "u",
      togetherAudience: "friends",
      togetherConnection: "online",
    },
  });
  expect(mockSelect).not.toHaveBeenCalled();
});
it("selects an invite-only audience and Android host transport explicitly", () => {
  const r = renderWithTheme(<TogetherStartContainer />);
  fireEvent.press(r.getByLabelText("Choose Push"));
  fireEvent.press(r.getByText("Private"));
  fireEvent.press(r.getByText("Next · choose connection"));
  fireEvent.press(r.getByText("This Android phone’s hotspot"));
  fireEvent.press(r.getByText("Start Together session"));
  expect(mockSelect).toHaveBeenCalledWith("hotspot-owner");
});
