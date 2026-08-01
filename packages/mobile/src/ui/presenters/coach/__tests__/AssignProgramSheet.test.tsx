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
import type { ReactNode } from "react";
import config from "../../../../../tamagui.config";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useAssignProgramSheet } from "@/state/assign-program-sheet";
import { useUserMode } from "@/state/user-mode";
import {
  AssignProgramSheet,
  assignErrorCopy,
} from "@/ui/presenters/coach/AssignProgramSheet";
import { makeTrainerClients } from "@/ui/presenters/coach/__tests__/trainerClients.fixture";

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: [] }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

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
  useAssignProgramSheet.setState({
    open: false,
    programId: null,
    onAssigned: null,
  });
  // Every existing test below exercises the sheet as a trainer would (it's a
  // coach-only surface) — the role gate added for launch fan-out reduction
  // (see the "role gating" describe block) means the data fetches would
  // otherwise never fire without this.
  useUserMode.setState({ mode: "coach", isTrainerEligible: true });
});

describe("assignErrorCopy", () => {
  it("maps every known programCode to friendly copy", () => {
    expect(assignErrorCopy("already_assigned")).toMatch(/already has/i);
    expect(assignErrorCopy("PROGRAM_EMPTY")).toMatch(/add workouts/i);
    expect(assignErrorCopy("not_your_client")).toMatch(/active clients/i);
    expect(assignErrorCopy("not_found")).toMatch(/no longer exists/i);
    expect(assignErrorCopy(undefined)).toMatch(/couldn't assign/i);
  });
});

describe("AssignProgramSheet", () => {
  it("renders nothing (sheet hidden) when the store is closed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    expect(screen.queryByTestId("assign-program-sheet")).toBeNull();
  });

  it("lists only active clients from the roster", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-client-c-priya")).toBeTruthy(),
    );
    // c-noah is "pending" in the fixture — must not appear.
    expect(screen.queryByTestId("assign-client-c-noah")).toBeNull();
  });

  it("defaults the start date to today in YYYY-MM-DD format", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-start-date")).toBeTruthy(),
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(screen.getByTestId("assign-start-date").props.value).toBe(today);
  });

  it("submits assignProgram with the selected client + toggles, then closes and calls onAssigned", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    const onAssigned = jest.fn();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1", onAssigned);
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-client-c-priya")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-client-c-priya"));
    fireEvent(
      screen.getByTestId("assign-toggle-library"),
      "valueChange",
      false,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-submit"));
    });

    await waitFor(() => expect(onAssigned).toHaveBeenCalledTimes(1));
    expect(api.assignProgramCalls).toHaveLength(1);
    expect(api.assignProgramCalls[0]).toMatchObject({
      programId: "program-1",
      input: {
        clientId: "c-priya",
        showInPlan: true,
        showInLibrary: false,
      },
    });
    expect(useAssignProgramSheet.getState().open).toBe(false);
  });

  it("disables Assign until a client is selected", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-submit")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("assign-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("maps a 409 already_assigned failure to friendly inline copy without closing", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    api.nextProgramError = {
      code: "already_assigned",
      message: "boom",
    };
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-client-c-priya")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-client-c-priya"));

    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-submit"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("assign-error")).toBeTruthy(),
    );
    expect(screen.getByText(/already has this programme/i)).toBeTruthy();
    expect(useAssignProgramSheet.getState().open).toBe(true);
  });

  it("maps a 422 PROGRAM_EMPTY failure to friendly inline copy", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    api.nextProgramError = { code: "PROGRAM_EMPTY", message: "boom" };
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-client-c-priya")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-client-c-priya"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-submit"));
    });
    await waitFor(() => expect(screen.getByText(/add workouts/i)).toBeTruthy());
  });

  it("maps a 403 not_your_client failure to friendly inline copy", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    api.nextProgramError = { code: "not_your_client", message: "boom" };
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-client-c-priya")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-client-c-priya"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-submit"));
    });
    await waitFor(() =>
      expect(screen.getByText(/your active clients/i)).toBeTruthy(),
    );
  });

  it("resets the form when the sheet closes", async () => {
    const { adapters, api } = makeAdapters();
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-1");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-client-c-priya")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-client-c-priya"));

    act(() => {
      useAssignProgramSheet.getState().closeSheet();
    });
    act(() => {
      useAssignProgramSheet.getState().openSheet("program-2");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-client-c-priya")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("assign-client-c-priya").props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  // -- client-anchored mode (openForClient, from Client Detail) --

  const PROGRAMME = {
    id: "prog-9",
    name: "Hypertrophy 8wk",
    description: null,
    durationWeeks: 8,
    daysPerWeek: 5,
    workoutCount: 5,
    activeClientCount: 0,
    createdAt: null,
    updatedAt: null,
  };

  it("client-anchored: picks a PROGRAMME and assigns it to the fixed client", async () => {
    const { adapters, api } = makeAdapters();
    api.programs = [PROGRAMME];
    const onAssigned = jest.fn();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openForClient("client-42", onAssigned);
    });
    // Program picker (not the client picker) is shown.
    await waitFor(() =>
      expect(screen.getByTestId("assign-program-prog-9")).toBeTruthy(),
    );
    expect(screen.queryByTestId("assign-client-c-priya")).toBeNull();

    fireEvent.press(screen.getByTestId("assign-program-prog-9"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-submit"));
    });

    await waitFor(() => expect(onAssigned).toHaveBeenCalledTimes(1));
    expect(api.assignProgramCalls[0]).toMatchObject({
      programId: "prog-9",
      input: { clientId: "client-42" },
    });
    expect(useAssignProgramSheet.getState().open).toBe(false);
  });

  it("client-anchored: disables Assign until a programme is picked", async () => {
    const { adapters, api } = makeAdapters();
    api.programs = [PROGRAMME];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <AssignProgramSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignProgramSheet.getState().openForClient("client-42");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-submit")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("assign-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  // Role gating (launch fan-out reduction): this sheet is root-mounted always
  // (feedback_sheets_mount_at_root) and coach-only. Without the eligibility
  // check every athlete's cold launch fired `/trainers/me/clients` +
  // `/trainers/me/programs`, both of which can only ever 403 for a
  // non-trainer.
  describe("role gating (isTrainerEligible)", () => {
    it("a non-trainer, even with the sheet open, fires no client/programme requests", async () => {
      const { adapters, api } = makeAdapters();
      api.trainerClients = makeTrainerClients();
      api.programs = [PROGRAMME];
      useUserMode.setState({ mode: "athlete", isTrainerEligible: false });
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <AssignProgramSheet />
        </Wrapper>,
      );
      act(() => {
        useAssignProgramSheet.getState().openSheet("program-1");
      });
      await waitFor(() =>
        expect(screen.getByTestId("assign-program-sheet")).toBeTruthy(),
      );
      // Give any (incorrectly) in-flight fetch a chance to land.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(api.getTrainerClientsCalls).toBe(0);
      expect(api.listProgramsCalls).toBe(0);
      // No roster fixture ever arrives — the picker shows the empty state.
      expect(screen.getByText(/no active clients yet/i)).toBeTruthy();
    });

    it("a trainer with the sheet open fires the client/programme requests", async () => {
      const { adapters, api } = makeAdapters();
      api.trainerClients = makeTrainerClients();
      api.programs = [PROGRAMME];
      useUserMode.setState({ mode: "coach", isTrainerEligible: true });
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <AssignProgramSheet />
        </Wrapper>,
      );
      act(() => {
        useAssignProgramSheet.getState().openSheet("program-1");
      });
      await waitFor(() =>
        expect(api.getTrainerClientsCalls).toBeGreaterThan(0),
      );
      expect(api.listProgramsCalls).toBeGreaterThan(0);
    });

    it("a never-opened sheet fires nothing even for an eligible trainer", async () => {
      const { adapters, api } = makeAdapters();
      api.trainerClients = makeTrainerClients();
      useUserMode.setState({ mode: "coach", isTrainerEligible: true });
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <AssignProgramSheet />
        </Wrapper>,
      );
      // Sheet starts closed (beforeEach) — trainer-eligible alone must not fetch.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(api.getTrainerClientsCalls).toBe(0);
      expect(api.listProgramsCalls).toBe(0);
    });

    // The sheet is root-mounted, so CLOSING it is not an unmount — the tree
    // stays alive with `enabled` flipped back to false. This exercises that
    // transition rather than only the never-opened case: the pre-existing
    // version of this test asserted a sheet that was never opened, which is
    // structurally incapable of catching a close-transition regression
    // (Inspector Brad).
    it("closing an opened sheet stops further requests, and reopening does not re-spam", async () => {
      const { adapters, api } = makeAdapters();
      api.trainerClients = makeTrainerClients();
      api.programs = [PROGRAMME];
      useUserMode.setState({ mode: "coach", isTrainerEligible: true });
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <AssignProgramSheet />
        </Wrapper>,
      );

      act(() => {
        useAssignProgramSheet.getState().openSheet("program-1");
      });
      await waitFor(() =>
        expect(api.getTrainerClientsCalls).toBeGreaterThan(0),
      );
      const clientsAfterOpen = api.getTrainerClientsCalls;
      const programsAfterOpen = api.listProgramsCalls;

      act(() => {
        useAssignProgramSheet.getState().closeSheet();
      });
      // Let any chain that failed to stop itself schedule and fire.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(api.getTrainerClientsCalls).toBe(clientsAfterOpen);
      expect(api.listProgramsCalls).toBe(programsAfterOpen);

      // Reopening reads the now-fresh cache rather than refetching — the
      // one-shot latch is armed for this user and the data is no longer stale.
      act(() => {
        useAssignProgramSheet.getState().openSheet("program-1");
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(api.getTrainerClientsCalls).toBe(clientsAfterOpen);
      expect(api.listProgramsCalls).toBe(programsAfterOpen);
    });
  });
});
