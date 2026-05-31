import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Avatar, type AvatarTone } from "../Avatar";

const TONES: AvatarTone[] = ["primary", "gold", "trainer"];

describe("Avatar", () => {
  it("renders initials", () => {
    const { getByText } = renderWithTheme(<Avatar initials="BE" />);
    expect(getByText("BE")).toBeTruthy();
  });

  it("defaults the accessibilityLabel to `Avatar {initials}`", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar initials="BE" testID="av" />,
    );
    expect(getByTestId("av").props.accessibilityLabel).toBe("Avatar BE");
  });

  it("uses an explicit accessibilityLabel when provided", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar initials="BE" accessibilityLabel="Bradley Evans" testID="av" />,
    );
    expect(getByTestId("av").props.accessibilityLabel).toBe("Bradley Evans");
  });

  it("renders as a non-pressable image role without onPress", () => {
    const { getByTestId } = renderWithTheme(
      <Avatar initials="BE" testID="av" />,
    );
    expect(getByTestId("av").props.accessibilityRole).toBe("image");
  });

  it("renders as a button + fires onPress when pressable", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Avatar initials="BE" onPress={onPress} testID="av" />,
    );
    expect(getByTestId("av").props.accessibilityRole).toBe("button");
    fireEvent.press(getByTestId("av"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(TONES)("renders tone %s", (tone) => {
    const { getByText } = renderWithTheme(<Avatar initials="AB" tone={tone} />);
    expect(getByText("AB")).toBeTruthy();
  });

  it.each(["success", "warning", "error"] as const)(
    "renders status dot %s",
    (dot) => {
      const { getByTestId } = renderWithTheme(
        <Avatar initials="AB" dot={dot} testID="av" />,
      );
      expect(getByTestId("av-dot")).toBeTruthy();
    },
  );

  it("renders a COACH badge", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <Avatar initials="AB" badge="COACH" testID="av" />,
    );
    expect(getByText("COACH")).toBeTruthy();
    expect(getByTestId("av-badge")).toBeTruthy();
  });

  it("scales the initials font-size with the avatar size", () => {
    const { getByText } = renderWithTheme(<Avatar initials="AB" size={56} />);
    const text = getByText("AB");
    const flat = Array.isArray(text.props.style)
      ? Object.assign({}, ...text.props.style)
      : text.props.style;
    expect(flat.fontSize).toBe(Math.round(56 * 0.36));
  });

  it("renders dot + badge without a testID (no sub-ids emitted)", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <Avatar initials="AB" dot="success" badge="COACH" />,
    );
    expect(getByText("COACH")).toBeTruthy();
    expect(queryByTestId("av-dot")).toBeNull();
    expect(queryByTestId("av-badge")).toBeNull();
  });

  it("renders a pressable avatar without throwing", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Avatar initials="AB" onPress={onPress} testID="av" />,
    );
    fireEvent.press(getByTestId("av"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(getByTestId("av")).toBeTruthy();
  });
});
