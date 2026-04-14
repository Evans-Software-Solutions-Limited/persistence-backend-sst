import { Text } from "react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Card } from "../Card";

describe("Card", () => {
  it("renders children", () => {
    const { getByText } = renderWithTheme(
      <Card>
        <Text>Card content</Text>
      </Card>,
    );
    expect(getByText("Card content")).toBeTruthy();
  });

  it("renders with elevated variant", () => {
    const { getByText } = renderWithTheme(
      <Card elevated>
        <Text>Elevated</Text>
      </Card>,
    );
    expect(getByText("Elevated")).toBeTruthy();
  });

  it("renders with outlined variant", () => {
    const { getByText } = renderWithTheme(
      <Card outlined>
        <Text>Outlined</Text>
      </Card>,
    );
    expect(getByText("Outlined")).toBeTruthy();
  });

  it("renders with pressable variant", () => {
    const { getByText } = renderWithTheme(
      <Card pressable>
        <Text>Pressable</Text>
      </Card>,
    );
    expect(getByText("Pressable")).toBeTruthy();
  });

  it("renders with testID", () => {
    const { getByTestId } = renderWithTheme(
      <Card testID="card">
        <Text>Test</Text>
      </Card>,
    );
    expect(getByTestId("card")).toBeTruthy();
  });
});
