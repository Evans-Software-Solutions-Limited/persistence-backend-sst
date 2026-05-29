import { View } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import type { Tone } from "../../foundation/tones";
import { MicroPill } from "../MicroPill";

const TONES: Tone[] = [
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];
const icon = <View testID="mp-icon" />;

const flatten = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return (style as Record<string, unknown>) ?? {};
};

describe("MicroPill", () => {
  it("renders icon + value + label", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <MicroPill icon={icon} value="12" label="Streak" tone="primary" />,
    );
    expect(getByTestId("mp-icon")).toBeTruthy();
    expect(getByText("12")).toBeTruthy();
    expect(getByText("Streak")).toBeTruthy();
  });

  it("renders the value in the mono family with tabular figures", () => {
    const { getByText } = renderWithTheme(
      <MicroPill icon={icon} value="2.4L" label="Water" tone="primary" />,
    );
    const value = getByText("2.4L");
    expect(JSON.stringify(value.props)).toContain("tabular-nums");
    const flat = flatten(value.props.style);
    expect(String(flat.fontFamily ?? "")).toMatch(/mono/i);
  });

  it.each(TONES)("renders tone %s", (tone) => {
    const { getByText } = renderWithTheme(
      <MicroPill icon={icon} value="1" label={tone} tone={tone} />,
    );
    expect(getByText(tone)).toBeTruthy();
  });

  it("defaults accessibilityLabel to `{label} {value}`", () => {
    const { getByTestId } = renderWithTheme(
      <MicroPill
        icon={icon}
        value="7h"
        label="Sleep"
        tone="trainer"
        testID="mp"
      />,
    );
    expect(getByTestId("mp").props.accessibilityLabel).toBe("Sleep 7h");
  });

  it("honours an explicit accessibilityLabel", () => {
    const { getByTestId } = renderWithTheme(
      <MicroPill
        icon={icon}
        value="7h"
        label="Sleep"
        tone="trainer"
        accessibilityLabel="Slept seven hours"
        testID="mp"
      />,
    );
    expect(getByTestId("mp").props.accessibilityLabel).toBe(
      "Slept seven hours",
    );
  });
});
