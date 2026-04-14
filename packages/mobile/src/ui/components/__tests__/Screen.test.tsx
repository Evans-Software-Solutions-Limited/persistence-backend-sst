import { Text } from "react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Screen } from "../Screen";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

describe("Screen", () => {
  it("renders children", () => {
    const { getByText } = renderWithTheme(
      <Screen>
        <Text>Content</Text>
      </Screen>,
    );
    expect(getByText("Content")).toBeTruthy();
  });

  it("renders with testID", () => {
    const { getByTestId } = renderWithTheme(
      <Screen testID="screen">
        <Text>Content</Text>
      </Screen>,
    );
    expect(getByTestId("screen")).toBeTruthy();
  });

  it("renders with scroll option", () => {
    const { getByText } = renderWithTheme(
      <Screen scroll>
        <Text>Scrollable</Text>
      </Screen>,
    );
    expect(getByText("Scrollable")).toBeTruthy();
  });

  it("renders with padded and centered variants", () => {
    const { getByText } = renderWithTheme(
      <Screen padded centered>
        <Text>Centered</Text>
      </Screen>,
    );
    expect(getByText("Centered")).toBeTruthy();
  });
});
