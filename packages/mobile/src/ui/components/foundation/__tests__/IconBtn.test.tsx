import { fireEvent } from "@testing-library/react-native";
import { View } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { IconBtn, type IconBtnTone, iconBtnForeground } from "../IconBtn";

const TONES: IconBtnTone[] = [
  "neutral",
  "ghost",
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];

const icon = <View testID="the-icon" />;
/** An icon that reads its injected `color` prop, like a lucide icon does. */
const ColorProbe = (props: { color?: string }) => (
  <View testID="color-probe" accessibilityLabel={props.color} />
);

describe("IconBtn", () => {
  it("renders the icon", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} testID="ib" />,
    );
    expect(getByTestId("the-icon")).toBeTruthy();
  });

  it("injects a concrete-hex tone colour onto the icon, overriding iconDefaults' currentColor (PR #83 Lead 1)", () => {
    // Caller passes the iconDefaults-style placeholder; IconBtn must override it
    // with a real colour SVG can render — not a token, not 'currentColor'.
    const { getByTestId } = renderWithTheme(
      <IconBtn
        tone="primary"
        icon={<ColorProbe color="currentColor" />}
        testID="ib"
      />,
    );
    expect(getByTestId("color-probe").props.accessibilityLabel).toBe("#22D3EE");
  });

  it("injects the active primary hex regardless of tone", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn
        tone="gold"
        active
        icon={<ColorProbe color="currentColor" />}
        testID="ib"
      />,
    );
    expect(getByTestId("color-probe").props.accessibilityLabel).toBe("#22D3EE");
  });

  it("preserves an explicit concrete colour the caller set on the icon", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn
        tone="primary"
        icon={<ColorProbe color="#FF0000" />}
        testID="ib"
      />,
    );
    expect(getByTestId("color-probe").props.accessibilityLabel).toBe("#FF0000");
  });

  it("renders as a non-pressable View when no onPress (nest-safe)", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} testID="ib" />,
    );
    const node = getByTestId("ib");
    // A plain View has no button accessibilityRole / onPress handler.
    expect(node.props.accessibilityRole).toBeUndefined();
    expect(node.props.onClick ?? node.props.onPress).toBeUndefined();
  });

  it("renders as a Pressable and fires onPress when onPress supplied", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} onPress={onPress} testID="ib" />,
    );
    const node = getByTestId("ib");
    expect(node.props.accessibilityRole).toBe("button");
    fireEvent.press(node);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("stops propagation so taps don't bubble to a parent row", () => {
    const onPress = jest.fn();
    const stopPropagation = jest.fn();
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} onPress={onPress} testID="ib" />,
    );
    fireEvent.press(getByTestId("ib"), { stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(TONES)("renders tone %s", (tone) => {
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} tone={tone} testID="ib" />,
    );
    expect(getByTestId("ib")).toBeTruthy();
  });

  it("renders the active state", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} onPress={() => undefined} active testID="ib" />,
    );
    expect(getByTestId("ib").props.accessibilityState.selected).toBe(true);
  });

  it("does not fire onPress when disabled", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} onPress={onPress} disabled testID="ib" />,
    );
    fireEvent.press(getByTestId("ib"));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId("ib").props.accessibilityState.disabled).toBe(true);
  });

  it("forwards accessibilityLabel on the pressable", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn
        icon={icon}
        onPress={() => undefined}
        accessibilityLabel="More options"
        testID="ib"
      />,
    );
    expect(getByTestId("ib").props.accessibilityLabel).toBe("More options");
  });

  it("forwards accessibilityLabel on the non-pressable variant", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} accessibilityLabel="Status" testID="ib" />,
    );
    expect(getByTestId("ib").props.accessibilityLabel).toBe("Status");
  });

  it("renders a custom size", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} size={44} testID="ib" />,
    );
    expect(getByTestId("ib")).toBeTruthy();
  });

  it("renders an unread badge with the count when badgeCount > 0", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <IconBtn icon={icon} badgeCount={3} testID="ib" />,
    );
    expect(getByTestId("ib-badge")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
  });

  it("hides the badge when badgeCount is 0 or undefined", () => {
    const { queryByTestId, rerender } = renderWithTheme(
      <IconBtn icon={icon} badgeCount={0} testID="ib" />,
    );
    expect(queryByTestId("ib-badge")).toBeNull();
    rerender(<IconBtn icon={icon} testID="ib" />);
    expect(queryByTestId("ib-badge")).toBeNull();
  });

  it("caps the badge label at 99+", () => {
    const { getByText } = renderWithTheme(
      <IconBtn icon={icon} badgeCount={250} testID="ib" />,
    );
    expect(getByText("99+")).toBeTruthy();
  });
});

describe("iconBtnForeground", () => {
  it("returns the concrete primary hex when active regardless of tone", () => {
    expect(iconBtnForeground("gold", true)).toBe("#22D3EE");
  });

  it("returns the tone foreground as concrete hex when resting", () => {
    expect(iconBtnForeground("neutral")).toBe("#C2C2CE");
    expect(iconBtnForeground("ghost")).toBe("#C2C2CE");
    expect(iconBtnForeground("primary")).toBe("#22D3EE");
    expect(iconBtnForeground("gold")).toBe("#F5C518");
  });
});
