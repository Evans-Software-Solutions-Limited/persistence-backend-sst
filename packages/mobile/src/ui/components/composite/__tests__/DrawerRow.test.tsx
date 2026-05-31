import { fireEvent } from "@testing-library/react-native";
import { View } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Pill } from "../../foundation/Pill";
import { DrawerRow } from "../DrawerRow";

const icon = <View testID="row-icon" />;

describe("DrawerRow", () => {
  it("renders icon + title + sub", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <DrawerRow icon={icon} title="Profile details" sub="Name, email" />,
    );
    expect(getByTestId("row-icon")).toBeTruthy();
    expect(getByText("Profile details")).toBeTruthy();
    expect(getByText("Name, email")).toBeTruthy();
  });

  it("renders a trailing slot (e.g. a count pill)", () => {
    const { getByText } = renderWithTheme(
      <DrawerRow
        icon={icon}
        title="Achievements"
        trailing={<Pill tone="gold">12</Pill>}
      />,
    );
    expect(getByText("12")).toBeTruthy();
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <DrawerRow icon={icon} title="Settings" onPress={onPress} testID="row" />,
    );
    fireEvent.press(getByTestId("row"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("defaults accessibilityLabel to the title on the pressable", () => {
    const { getByTestId } = renderWithTheme(
      <DrawerRow
        icon={icon}
        title="Settings"
        onPress={() => undefined}
        testID="row"
      />,
    );
    expect(getByTestId("row").props.accessibilityLabel).toBe("Settings");
  });

  it("renders skeleton blocks when loading (and is not pressable)", () => {
    const onPress = jest.fn();
    const { getByTestId, queryByText } = renderWithTheme(
      <DrawerRow
        icon={icon}
        title="Profile details"
        sub="Name, email"
        loading
        onPress={onPress}
        testID="row"
      />,
    );
    expect(getByTestId("row-skeleton-title")).toBeTruthy();
    expect(queryByText("Profile details")).toBeNull();
    // A loading row renders as a plain View, so there's no button role to press.
    expect(getByTestId("row").props.accessibilityRole).toBeUndefined();
  });

  it("renders a non-pressable row without onPress", () => {
    const { getByText } = renderWithTheme(
      <DrawerRow icon={icon} title="Static row" />,
    );
    expect(getByText("Static row")).toBeTruthy();
  });

  it("uses an explicit accessibilityLabel over the title", () => {
    const { getByTestId } = renderWithTheme(
      <DrawerRow
        icon={icon}
        title="Settings"
        accessibilityLabel="Open settings"
        onPress={() => undefined}
        testID="row"
      />,
    );
    expect(getByTestId("row").props.accessibilityLabel).toBe("Open settings");
  });

  it("renders a loading row without a testID (no skeleton sub-id)", () => {
    const { queryByTestId, getByText } = renderWithTheme(
      <DrawerRow icon={icon} title="x" sub="y" loading />,
    );
    // No testID → no `${testID}-skeleton-title` id is emitted, but it renders.
    expect(queryByTestId("row-skeleton-title")).toBeNull();
    expect(() => getByText("x")).toThrow();
  });
});
