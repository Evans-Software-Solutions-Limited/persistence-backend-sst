import { render, waitFor, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import type { Adapters } from "@/shared/types";
import type { AthleteProgramDetail } from "@/domain/models/program";
import type { AthleteProgramPresenterProps } from "@/ui/presenters/AthleteProgramPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { AthleteProgramContainer } from "../AthleteProgramContainer";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockProbe: { last: AthleteProgramPresenterProps | null } = { last: null };

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
}));
jest.mock("@/ui/presenters/AthleteProgramPresenter", () => ({
  AthleteProgramPresenter: (props: AthleteProgramPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const DETAIL: AthleteProgramDetail = {
  id: "prog-1",
  name: "Hypertrophy Block",
  description: null,
  durationWeeks: 8,
  daysPerWeek: 4,
  workoutCount: 1,
  status: "started",
  startDate: "2026-07-01",
  endDate: null,
  week: 2,
  workouts: [
    {
      id: "pw-1",
      workoutId: "w-a",
      position: 0,
      name: "Upper A",
      estimatedDurationMinutes: 55,
    },
  ],
};

function makeAdapters(detail: AthleteProgramDetail | null): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
} {
  const api = new InMemoryApiAdapter();
  api.athleteProgramDetail = detail;
  return { api, adapters: { api } as unknown as Adapters };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

describe("AthleteProgramContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockPush.mockClear();
    mockBack.mockClear();
  });

  it("fetches the athlete programme and passes it to the presenter", async () => {
    const { adapters, api } = makeAdapters(DETAIL);
    render(
      <Wrapper adapters={adapters}>
        <AthleteProgramContainer programId="prog-1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.program).not.toBeNull());
    expect(mockProbe.last?.program?.id).toBe("prog-1");
    expect(api.getAthleteProgramCalls).toEqual(["prog-1"]);
  });

  it("surfaces an error when the programme isn't assigned/found", async () => {
    const { adapters } = makeAdapters(null);
    render(
      <Wrapper adapters={adapters}>
        <AthleteProgramContainer programId="prog-x" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.error).not.toBeNull());
    expect(mockProbe.last?.program).toBeNull();
  });

  it("opening a workout pushes the workout route", async () => {
    const { adapters } = makeAdapters(DETAIL);
    render(
      <Wrapper adapters={adapters}>
        <AthleteProgramContainer programId="prog-1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.program).not.toBeNull());
    act(() => mockProbe.last?.onOpenWorkout("w-a"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/w-a");
  });

  it("back navigates when possible", async () => {
    const { adapters } = makeAdapters(DETAIL);
    render(
      <Wrapper adapters={adapters}>
        <AthleteProgramContainer programId="prog-1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onBack());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
