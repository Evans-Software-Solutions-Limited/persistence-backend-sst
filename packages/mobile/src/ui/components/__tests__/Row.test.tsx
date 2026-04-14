import { Text } from "react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Row } from "../Row";

describe("Row", () => {
  it("renders children horizontally", () => {
    const { getByText } = renderWithTheme(
      <Row>
        <Text>Left</Text>
        <Text>Right</Text>
      </Row>,
    );
    expect(getByText("Left")).toBeTruthy();
    expect(getByText("Right")).toBeTruthy();
  });

  it("renders with gap variant", () => {
    const { getByText } = renderWithTheme(
      <Row gap="md">
        <Text>A</Text>
        <Text>B</Text>
      </Row>,
    );
    expect(getByText("A")).toBeTruthy();
  });

  it("renders with justify variant", () => {
    const { getByText } = renderWithTheme(
      <Row justify="between">
        <Text>Start</Text>
        <Text>End</Text>
      </Row>,
    );
    expect(getByText("Start")).toBeTruthy();
  });

  it("renders with wrap variant", () => {
    const { getByText } = renderWithTheme(
      <Row wrap>
        <Text>Wrapped</Text>
      </Row>,
    );
    expect(getByText("Wrapped")).toBeTruthy();
  });
});
