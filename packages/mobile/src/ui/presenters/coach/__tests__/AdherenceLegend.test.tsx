import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import { AdherenceLegend } from "../AdherenceLegend";

describe("AdherenceLegend", () => {
  it("renders the heading, blurb, and all four ranges", () => {
    const { getByText } = renderWithTheme(
      <AdherenceLegend onClose={jest.fn()} testID="legend" />,
    );
    expect(getByText("How adherence is scored")).toBeTruthy();
    expect(getByText(/Composite of workouts completed/)).toBeTruthy();
    expect(getByText("Stellar")).toBeTruthy();
    expect(getByText("95+%")).toBeTruthy();
    expect(getByText("Strong")).toBeTruthy();
    expect(getByText("85-94%")).toBeTruthy();
    expect(getByText("Wobbling")).toBeTruthy();
    expect(getByText("65-84%")).toBeTruthy();
    expect(getByText("At risk")).toBeTruthy();
    expect(getByText("<65%")).toBeTruthy();
  });

  it("fires onClose from the dismiss button", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AdherenceLegend onClose={onClose} testID="legend" />,
    );
    fireEvent.press(getByTestId("legend-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders without a testID (no derived child ids)", () => {
    const { getByText } = renderWithTheme(
      <AdherenceLegend onClose={jest.fn()} />,
    );
    expect(getByText("How adherence is scored")).toBeTruthy();
  });
});
