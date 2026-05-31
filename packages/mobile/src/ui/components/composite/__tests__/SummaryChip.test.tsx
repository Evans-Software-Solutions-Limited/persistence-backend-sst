import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import type { Tone } from "../../foundation/tones";
import { SummaryChip, summaryChipPressStyle } from "../SummaryChip";
const TONES: Tone[] = [
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];

describe("SummaryChip", () => {
  it("renders count + label", () => {
    const { getByText } = renderWithTheme(
      <SummaryChip count={3} label="Need attention" tone="ember" />,
    );
    expect(getByText("3")).toBeTruthy();
    expect(getByText("Need attention")).toBeTruthy();
  });

  it("renders the count in the mono family", () => {
    const { getByText } = renderWithTheme(
      <SummaryChip count={8} label="Active" tone="success" />,
    );
    const count = getByText("8");
    const flat = Array.isArray(count.props.style)
      ? Object.assign({}, ...count.props.style)
      : count.props.style;
    expect(String(flat.fontFamily ?? "")).toMatch(/mono/i);
  });

  it.each(TONES)("renders tone %s", (tone) => {
    const { getByText } = renderWithTheme(
      <SummaryChip count={1} label={tone} tone={tone} />,
    );
    expect(getByText(tone)).toBeTruthy();
  });

  it("fires onPress when pressable", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SummaryChip
        count={2}
        label="Waiting"
        tone="primary"
        onPress={onPress}
        testID="chip"
      />,
    );
    expect(getByTestId("chip").props.accessibilityRole).toBe("button");
    fireEvent.press(getByTestId("chip"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders as a non-pressable View without onPress", () => {
    const { getByTestId } = renderWithTheme(
      <SummaryChip count={2} label="Waiting" tone="primary" testID="chip" />,
    );
    expect(getByTestId("chip").props.accessibilityRole).toBeUndefined();
  });

  it("composes an accessibilityLabel from count + label", () => {
    const { getByTestId } = renderWithTheme(
      <SummaryChip count={3} label="missed" tone="error" testID="chip" />,
    );
    expect(getByTestId("chip").props.accessibilityLabel).toBe("3 missed");
  });

  it("applies a pressed opacity on the pressable style function", () => {
    expect(summaryChipPressStyle({ pressed: true }).opacity).toBe(0.8);
    expect(summaryChipPressStyle({ pressed: false }).opacity).toBe(1);
  });

  it("honours an explicit accessibilityLabel", () => {
    const { getByTestId } = renderWithTheme(
      <SummaryChip
        count={3}
        label="missed"
        tone="error"
        accessibilityLabel="3 clients missed sessions"
        testID="chip"
      />,
    );
    expect(getByTestId("chip").props.accessibilityLabel).toBe(
      "3 clients missed sessions",
    );
  });
});
