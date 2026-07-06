import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TamaguiProvider } from "@tamagui/core";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Alert } from "react-native";
import type { ReactNode } from "react";
import config from "../../../../tamagui.config";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useUserMode } from "@/state/user-mode";
import { useAssignProgramSheet } from "@/state/assign-program-sheet";
import { ProgramEditorContainer } from "@/ui/containers/ProgramEditorContainer";
import type { ProgramDetail } from "@/domain/models/program";

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: [] }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
  },
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function makeDetail(overrides: Partial<ProgramDetail> = {}): ProgramDetail {
  return {
    id: "p-1",
    name: "Strength Foundations",
    description: "Linear progression",
    durationWeeks: 12,
    daysPerWeek: 4,
    workoutCount: 2,
    activeClientCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    workouts: [
      {
        id: "pw-1",
        workoutId: "w-1",
        position: 0,
        name: "Push Day",
        estimatedDurationMinutes: 45,
      },
      {
        id: "pw-2",
        workoutId: "w-2",
        position: 1,
        name: "Pull Day",
        estimatedDurationMinutes: 40,
      },
    ],
    assignments: [
      {
        id: "a-1",
        clientId: "c-1",
        clientName: "Priya Shah",
        clientInitials: "PS",
        avatarUrl: null,
        startDate: "2026-05-01",
        endDate: null,
        status: "started",
        currentWeek: 3,
      },
    ],
    ...overrides,
  };
}

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3_600_000,
  };
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, api };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({
  adapters,
  queryClient,
  children,
}: {
  adapters: Adapters;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TamaguiProvider config={config} defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
        </QueryClientProvider>
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  mockFetch.mockClear();
  mockReplace.mockReset();
  mockBack.mockReset();
  useUserMode.setState({
    mode: "coach",
    isTrainerEligible: true,
    isEligibilityKnown: true,
  });
  useAssignProgramSheet.setState({
    open: false,
    programId: null,
    onAssigned: null,
  });
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProgramEditorContainer — mode gate", () => {
  it("redirects to the tabs index when not in coach mode", async () => {
    useUserMode.setState({
      mode: "athlete",
      isTrainerEligible: false,
      isEligibilityKnown: true,
    });
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)"),
    );
  });

  it("does not redirect when in coach mode", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-editor")).toBeTruthy(),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("ProgramEditorContainer — create mode", () => {
  it("renders blank fields with sensible defaults", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("New programme")).toBeTruthy());
    expect(screen.queryByTestId("program-editor-loader")).toBeNull();
  });

  it("creates the programme and navigates to its detail route on success", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-name")).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByTestId("program-name"), "New Cycle");

    await act(async () => {
      fireEvent.press(screen.getByTestId("program-save"));
    });

    await waitFor(() => expect(api.createProgramCalls).toHaveLength(1));
    expect(api.createProgramCalls[0]).toMatchObject({
      name: "New Cycle",
      daysPerWeek: 3,
      durationWeeks: 8,
      workoutIds: [],
    });
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringMatching(/^\/\(app\)\/programs\//),
      ),
    );
  });

  it("sends durationWeeks: null when Ongoing is selected", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-name")).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByTestId("program-name"), "Ongoing Cycle");
    fireEvent.press(screen.getByText("Ongoing"));

    await act(async () => {
      fireEvent.press(screen.getByTestId("program-save"));
    });

    await waitFor(() => expect(api.createProgramCalls).toHaveLength(1));
    expect(api.createProgramCalls[0]).toMatchObject({
      name: "Ongoing Cycle",
      durationWeeks: null,
    });
  });

  it("maps a 422 invalid_workouts create failure to friendly copy", async () => {
    const { adapters, api } = makeAdapters();
    api.nextProgramError = { code: "invalid_workouts", message: "boom" };
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-name")).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByTestId("program-name"), "New Cycle");
    await act(async () => {
      fireEvent.press(screen.getByTestId("program-save"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("program-save-error")).toBeTruthy(),
    );
    expect(screen.getByText(/must be your own or a public one/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("disables Save until a name is entered", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-save")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("program-save").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });
});

describe("ProgramEditorContainer — edit mode", () => {
  it("fetches the detail and seeds the form fields", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Strength Foundations")).toBeTruthy(),
    );
    expect(screen.getByDisplayValue("Linear progression")).toBeTruthy();
    expect(screen.getByText("Push Day")).toBeTruthy();
    expect(screen.getByText("Pull Day")).toBeTruthy();
    expect(screen.getByText("Priya Shah")).toBeTruthy();
  });

  it("seeds a null description as blank and an ongoing programme in Ongoing mode", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail({ description: null, durationWeeks: null });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Strength Foundations")).toBeTruthy(),
    );
    expect(screen.getByDisplayValue("")).toBeTruthy();
    expect(screen.getByText(/Runs indefinitely/i)).toBeTruthy();
    expect(screen.queryByTestId("program-duration-weeks")).toBeNull();
  });

  it("renders the error state on a 404", async () => {
    const { adapters } = makeAdapters();
    // No programDetail set -> getProgram 404s.
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="missing" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-editor-error")).toBeTruthy(),
    );
  });

  it("does not re-seed the form on a background refetch (seed-once guard)", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Strength Foundations")).toBeTruthy(),
    );

    // Simulate the coach editing the name locally, then a background refetch
    // (e.g. after assigning a client) lands with a DIFFERENT server name —
    // the seed-once guard must NOT stomp the in-progress edit.
    fireEvent.changeText(screen.getByTestId("program-name"), "My WIP Rename");
    api.programDetail = makeDetail({ name: "Server-Side Rename" });

    await act(async () => {
      fireEvent.press(screen.getByTestId("editor-assign-client"));
    });

    // Opening the assign sheet registers a refresh callback; invoke it to
    // simulate the sheet's onAssigned firing after a successful assign.
    const onAssigned = useAssignProgramSheet.getState().onAssigned;
    await act(async () => {
      onAssigned?.();
    });

    await waitFor(() => expect(api.getProgramCalls.length).toBeGreaterThan(1));
    // Local edit survives — the container never re-seeds `name` after the
    // first successful load.
    expect(screen.getByDisplayValue("My WIP Rename")).toBeTruthy();
    expect(screen.queryByDisplayValue("Server-Side Rename")).toBeNull();
  });

  it("refreshes the assignments list (not the metadata) on the registered refetch", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("Priya Shah")).toBeTruthy());

    api.programDetail = makeDetail({
      assignments: [
        {
          id: "a-2",
          clientId: "c-2",
          clientName: "Marcus Reid",
          clientInitials: "MR",
          avatarUrl: null,
          startDate: "2026-06-01",
          endDate: null,
          status: "assigned",
          currentWeek: 1,
        },
      ],
    });

    fireEvent.press(screen.getByTestId("editor-assign-client"));
    const onAssigned = useAssignProgramSheet.getState().onAssigned;
    await act(async () => {
      onAssigned?.();
    });

    await waitFor(() => expect(screen.getByText("Marcus Reid")).toBeTruthy());
  });

  it("opens the assign sheet with the current programId", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-assign-client")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("editor-assign-client"));
    expect(useAssignProgramSheet.getState().open).toBe(true);
    expect(useAssignProgramSheet.getState().programId).toBe("p-1");
  });

  it("updates the programme via api.updateProgram on Save", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Strength Foundations")).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByTestId("program-name"), "Renamed");
    await act(async () => {
      fireEvent.press(screen.getByTestId("program-save"));
    });
    await waitFor(() => expect(api.updateProgramCalls).toHaveLength(1));
    expect(api.updateProgramCalls[0]).toMatchObject({
      id: "p-1",
      input: expect.objectContaining({ name: "Renamed" }),
    });
  });

  it("deletes the programme and navigates back on success", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-delete")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("program-delete"));
    });
    await waitFor(() => expect(api.deleteProgramCalls).toEqual(["p-1"]));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("maps a 409 PROGRAM_HAS_LIVE_ASSIGNMENTS delete failure to a friendly Alert", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-delete")).toBeTruthy(),
    );
    api.nextProgramError = {
      code: "PROGRAM_HAS_LIVE_ASSIGNMENTS",
      message: "boom",
    };
    await act(async () => {
      fireEvent.press(screen.getByTestId("program-delete"));
    });
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "Can't delete yet",
        expect.stringMatching(/unassign all clients/i),
      ),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("maps an unrecognised delete failure to the generic error Alert", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-delete")).toBeTruthy(),
    );
    api.nextProgramError = { code: "not_found", message: "boom" };
    await act(async () => {
      fireEvent.press(screen.getByTestId("program-delete"));
    });
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        expect.stringMatching(/couldn't delete/i),
      ),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("maps an unrecognised update failure to the generic fallback copy", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Strength Foundations")).toBeTruthy(),
    );
    api.nextProgramError = { code: "not_your_client", message: "boom" };
    await act(async () => {
      fireEvent.press(screen.getByTestId("program-save"));
    });
    await waitFor(() =>
      expect(
        screen.getByText("Couldn't save the programme. Please try again."),
      ).toBeTruthy(),
    );
  });

  it("maps a 404 not_found update failure to friendly copy", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Strength Foundations")).toBeTruthy(),
    );
    api.nextProgramError = { code: "not_found", message: "boom" };
    await act(async () => {
      fireEvent.press(screen.getByTestId("program-save"));
    });
    await waitFor(() =>
      expect(screen.getByText("This programme no longer exists.")).toBeTruthy(),
    );
  });

  it("adds, reorders, and removes a workout via the picker + row controls", async () => {
    const { adapters, api } = makeAdapters();
    api.programDetail = makeDetail({ workouts: [] });
    api.workouts = [
      {
        id: "w-9",
        name: "Leg Day",
        description: null,
        createdBy: "test-user",
        visibility: "private",
        estimatedDurationMinutes: 30,
        exercises: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "w-10",
        name: "Arm Day",
        description: null,
        createdBy: "test-user",
        visibility: "private",
        estimatedDurationMinutes: 25,
        exercises: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("editor-add-workout")).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId("editor-add-workout"));
    await waitFor(() =>
      expect(screen.getByTestId("picker-workout-w-9")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("picker-workout-w-9"));
    fireEvent.press(screen.getByTestId("editor-add-workout"));
    fireEvent.press(screen.getByTestId("picker-workout-w-10"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-workout-1")).toBeTruthy(),
    );
    expect(screen.getByTestId("editor-workout-0")).toBeTruthy();

    // Reorder: move the second row up.
    fireEvent.press(screen.getByTestId("editor-workout-1-up"));
    // A no-op move (first row up) must not throw / change anything.
    fireEvent.press(screen.getByTestId("editor-workout-0-up"));
    // A no-op move (last row down) must not throw / change anything.
    fireEvent.press(screen.getByTestId("editor-workout-1-down"));

    fireEvent.press(screen.getByTestId("editor-workout-0-remove"));
    await waitFor(() =>
      expect(screen.queryByTestId("editor-workout-1")).toBeNull(),
    );
  });

  it("navigates back via the header back button", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-editor-back")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("program-editor-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("retries the detail load from the error state", async () => {
    const { adapters, api } = makeAdapters();
    // No programDetail set -> first getProgram 404s.
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramEditorContainer programId="p-1" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-editor-error")).toBeTruthy(),
    );
    api.programDetail = makeDetail();
    fireEvent.press(screen.getByText("Retry"));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Strength Foundations")).toBeTruthy(),
    );
  });
});
