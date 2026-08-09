import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  BodyHistoryPresenter,
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
    expect(getByText("17.5%")).toBeTruthy();
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
});
