import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Text } from "../Text";

describe("Text", () => {
  it("renders with default body variant", () => {
    const { getByText } = renderWithTheme(<Text>Hello world</Text>);
    expect(getByText("Hello world")).toBeTruthy();
  });

  it("renders h1 variant", () => {
    const { getByText } = renderWithTheme(<Text variant="h1">Heading</Text>);
    expect(getByText("Heading")).toBeTruthy();
  });

  it("renders h2 variant", () => {
    const { getByText } = renderWithTheme(<Text variant="h2">Subheading</Text>);
    expect(getByText("Subheading")).toBeTruthy();
  });

  it("renders caption variant", () => {
    const { getByText } = renderWithTheme(
      <Text variant="caption">Small text</Text>,
    );
    expect(getByText("Small text")).toBeTruthy();
  });

  it("renders label variant", () => {
    const { getByText } = renderWithTheme(<Text variant="label">Label</Text>);
    expect(getByText("Label")).toBeTruthy();
  });

  it("renders with secondary color", () => {
    const { getByText } = renderWithTheme(<Text secondary>Muted text</Text>);
    expect(getByText("Muted text")).toBeTruthy();
  });

  it("renders with align prop", () => {
    const { getByText } = renderWithTheme(<Text align="center">Centered</Text>);
    expect(getByText("Centered")).toBeTruthy();
  });
});
