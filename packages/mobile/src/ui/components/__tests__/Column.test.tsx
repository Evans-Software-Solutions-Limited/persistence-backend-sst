import { Text } from "react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Column } from "../Column";

describe("Column", () => {
  it("renders children", () => {
    const { getByText } = renderWithTheme(
      <Column>
        <Text>Top</Text>
        <Text>Bottom</Text>
      </Column>,
    );
    expect(getByText("Top")).toBeTruthy();
    expect(getByText("Bottom")).toBeTruthy();
  });

  it("renders with gap variant", () => {
    const { getByText } = renderWithTheme(
      <Column gap="lg">
        <Text>Item</Text>
      </Column>,
    );
    expect(getByText("Item")).toBeTruthy();
  });

  it("renders with centered variant", () => {
    const { getByText } = renderWithTheme(
      <Column centered>
        <Text>Centered</Text>
      </Column>,
    );
    expect(getByText("Centered")).toBeTruthy();
  });
});
