import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  BodyHistoryPresenter,
  prepareMetricHistory,
  type BodyHistoryPresenterProps,
} from "../BodyHistoryPresenter";

function render(overrides: Partial<BodyHistoryPresenterProps> = {}) {
  const props: BodyHistoryPresenterProps = {
    points: [
      { id: "m1", date: "2026-08-01", weightKg: 80, bodyFat: 18 },
      { id: "m2", date: "2026-08-08", weightKg: 79.5, bodyFat: 17.5 },
    ],
    weightUnit: "kg",
    isLoading: false,
    isRefreshing: false,
    error: null,
    onBack: jest.fn(),
    onRefresh: jest.fn(),
    ...overrides,
  };
  return { ...renderWithTheme(<BodyHistoryPresenter {...props} />), props };
}

describe("BodyHistoryPresenter", () => {
  it("shows measurement rows with the newest reading first", () => {
    const { getAllByText, getByText } = render();
    expect(getByText("79.5 kg")).toBeTruthy();
    expect(getAllByText(/Aug 2026/)).toHaveLength(2);
  });

  it("converts weights into the selected display unit", () => {
    const { getByText } = render({ weightUnit: "lb" });
    expect(getByText("175.3 lb")).toBeTruthy();
  });

  it("shows the branded blocking loader while the first read is pending", () => {
    const { getByTestId } = render({ points: [], isLoading: true });
    expect(getByTestId("body-history-loader")).toBeTruthy();
  });

  it("supports retry and back without hiding an existing history", () => {
    const onBack = jest.fn();
    const onRefresh = jest.fn();
    const failed = render({
      points: [],
      error: { kind: "api", code: "server", message: "boom" },
      onBack,
      onRefresh,
    });
    fireEvent.press(failed.getByText("Retry"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.press(failed.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);

    const populated = render({ onBack });
    fireEvent.press(populated.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("keeps same-day measurements as distinct rows", () => {
    const { getByTestId } = render({
      points: [
        { id: "morning", date: "2026-08-08", weightKg: 80, bodyFat: 18 },
        { id: "evening", date: "2026-08-08", weightKg: 79.8, bodyFat: 17.8 },
      ],
    });
    expect(getByTestId("body-history-row-morning")).toBeTruthy();
    expect(getByTestId("body-history-row-evening")).toBeTruthy();
  });

  it("sorts entries by measured timestamp and charts only the latest same-day point", () => {
    const { entries, graphPoints } = prepareMetricHistory(
      [
        {
          id: "late",
          measuredAt: "2026-08-08T20:00:00Z",
          date: "2026-08-08",
          weightKg: 79,
          bodyFat: 17,
        },
        {
          id: "next",
          measuredAt: "2026-08-09T08:00:00Z",
          date: "2026-08-09",
          weightKg: 78.5,
          bodyFat: 16.8,
        },
        {
          id: "early",
          measuredAt: "2026-08-08T08:00:00Z",
          date: "2026-08-08",
          weightKg: 80,
          bodyFat: 18,
        },
      ],
      "weight",
    );
    expect(entries.map((point) => point.id)).toEqual(["early", "late", "next"]);
    expect(graphPoints.map((point) => point.id)).toEqual(["late", "next"]);
  });

  it("uses separate body-fat copy, logging context and no overflow action", () => {
    const onLog = jest.fn();
    const { getByText, getByTestId, queryByLabelText } = render({
      metric: "bodyFat",
      onLog,
    });
    expect(getByText("17.5 %")).toBeTruthy();
    fireEvent.press(getByTestId("log-bodyFat-button"));
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(queryByLabelText(/more|overflow/i)).toBeNull();
  });
});
