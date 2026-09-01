import { act, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { BodyHistoryContainer } from "../BodyHistoryContainer";

const mockBack = jest.fn();
const mockUseGetBodyMeasurementHistory = jest.fn((_windowDays: number) => ({
  data: [],
  isLoading: false,
  error: null,
  refresh: jest.fn(async () => undefined),
}));
const mockUseProfilePage = jest.fn(() => ({
  payload: { profile: { weightUnit: "kg" } },
}));
const mockPresenter = jest.fn((_props: unknown) => null);
const mockTrackAnalyticsEvent = jest.fn(async () => ({ ok: true }));

jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
}));
jest.mock("@/ui/hooks/useGetBodyMeasurements", () => ({
  useGetBodyMeasurementHistory: (windowDays: number) =>
    mockUseGetBodyMeasurementHistory(windowDays),
}));
jest.mock("@/ui/hooks/useProfilePage", () => ({
  useProfilePage: () => mockUseProfilePage(),
}));
jest.mock("@/ui/presenters/BodyHistoryPresenter", () => ({
  BodyHistoryPresenter: (props: unknown) => mockPresenter(props),
}));
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    api: { trackAnalyticsEvent: mockTrackAnalyticsEvent },
  }),
}));

describe("BodyHistoryContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { useHomeSheets } = jest.requireActual("@/state/home-sheets") as {
      useHomeSheets: typeof import("@/state/home-sheets").useHomeSheets;
    };
    useHomeSheets.setState({ measurementsRev: 0 });
  });

  it("requests the endpoint's explicit past-year history window", () => {
    renderWithTheme(<BodyHistoryContainer />);
    expect(mockUseGetBodyMeasurementHistory).toHaveBeenCalledWith(366);
    expect(mockPresenter).toHaveBeenCalledWith(
      expect.objectContaining({ weightUnit: "kg", points: [] }),
    );
  });

  it("tracks the metric and refreshes after a successful history log", async () => {
    const refresh = jest.fn(async () => undefined);
    mockUseGetBodyMeasurementHistory.mockImplementation(() => ({
      data: [],
      isLoading: false,
      error: null,
      refresh,
    }));
    renderWithTheme(<BodyHistoryContainer metric="bodyFat" />);
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith({
      name: "body_fat_history_opened",
    });

    const { useHomeSheets } = jest.requireActual("@/state/home-sheets") as {
      useHomeSheets: typeof import("@/state/home-sheets").useHomeSheets;
    };
    act(() => useHomeSheets.getState().measurementLogged());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
