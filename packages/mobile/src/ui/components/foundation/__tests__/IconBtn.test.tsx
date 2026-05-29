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

describe("IconBtn", () => {
  it("renders the icon", () => {
    const { getByTestId } = renderWithTheme(
      <IconBtn icon={icon} testID="ib" />,
    );
    expect(getByTestId("the-icon")).toBeTruthy();
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
});

describe("iconBtnForeground", () => {
  it("returns $primary when active regardless of tone", () => {
    expect(iconBtnForeground("gold", true)).toBe("$primary");
  });

  it("returns the tone foreground when resting", () => {
    expect(iconBtnForeground("neutral")).toBe("$text2");
    expect(iconBtnForeground("ghost")).toBe("$text2");
    expect(iconBtnForeground("primary")).toBe("$primary");
    expect(iconBtnForeground("gold")).toBe("$gold");
  });
});
