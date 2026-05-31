import { Text } from "react-native";

import { renderWithTheme } from "../../../../../../__tests__/test-utils";
import { DrawerSection } from "../DrawerSection";

describe("DrawerSection", () => {
  it("renders the title (eyebrow) and children", () => {
    const { getByText } = renderWithTheme(
      <DrawerSection title="Account">
        <Text>child row</Text>
      </DrawerSection>,
    );
    expect(getByText("Account")).toBeTruthy();
    expect(getByText("child row")).toBeTruthy();
  });

  it("forwards a testID", () => {
    const { getByTestId } = renderWithTheme(
      <DrawerSection title="Preferences" testID="prefs-section">
        <Text>x</Text>
      </DrawerSection>,
    );
    expect(getByTestId("prefs-section")).toBeTruthy();
  });
});
