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

describe("BodyHistoryContainer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requests the endpoint's explicit past-year history window", () => {
    renderWithTheme(<BodyHistoryContainer />);
    expect(mockUseGetBodyMeasurementHistory).toHaveBeenCalledWith(366);
    expect(mockPresenter).toHaveBeenCalledWith(
      expect.objectContaining({ weightUnit: "kg", points: [] }),
    );
  });
});
