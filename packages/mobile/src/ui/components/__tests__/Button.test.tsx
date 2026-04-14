import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Button } from "../Button";

describe("Button", () => {
  const onPress = jest.fn();

  beforeEach(() => {
    onPress.mockClear();
  });

  it("renders with label", () => {
    const { getByText } = renderWithTheme(
      <Button label="Press me" onPress={onPress} />,
    );
    expect(getByText("Press me")).toBeTruthy();
  });

  it("has button accessibility role", () => {
    const { getByTestId } = renderWithTheme(
      <Button label="Submit" onPress={onPress} testID="btn" />,
    );
    expect(getByTestId("btn").props.accessibilityRole).toBe("button");
  });

  it("renders primary variant by default", () => {
    const { getByText } = renderWithTheme(
      <Button label="Primary" onPress={onPress} />,
    );
    expect(getByText("Primary")).toBeTruthy();
  });

  it("renders secondary variant", () => {
    const { getByText } = renderWithTheme(
      <Button label="Secondary" onPress={onPress} variant="secondary" />,
    );
    expect(getByText("Secondary")).toBeTruthy();
  });

  it("renders outline variant", () => {
    const { getByText } = renderWithTheme(
      <Button label="Outline" onPress={onPress} variant="outline" />,
    );
    expect(getByText("Outline")).toBeTruthy();
  });

  it("renders ghost variant", () => {
    const { getByText } = renderWithTheme(
      <Button label="Ghost" onPress={onPress} variant="ghost" />,
    );
    expect(getByText("Ghost")).toBeTruthy();
  });

  it("renders danger variant", () => {
    const { getByText } = renderWithTheme(
      <Button label="Delete" onPress={onPress} variant="danger" />,
    );
    expect(getByText("Delete")).toBeTruthy();
  });

  it("shows loading spinner when isLoading", () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <Button label="Loading" onPress={onPress} isLoading testID="btn" />,
    );
    expect(getByTestId("btn-spinner")).toBeTruthy();
    expect(queryByText("Loading")).toBeNull();
  });

  it("renders all size variants", () => {
    const sizes = ["sm", "md", "lg"] as const;
    for (const size of sizes) {
      const { getByText } = renderWithTheme(
        <Button label={`Size ${size}`} onPress={onPress} size={size} />,
      );
      expect(getByText(`Size ${size}`)).toBeTruthy();
    }
  });

  it("renders with accessibility state disabled", () => {
    const { getByTestId } = renderWithTheme(
      <Button label="Disabled" onPress={onPress} isDisabled testID="btn" />,
    );
    expect(getByTestId("btn").props.accessibilityState.disabled).toBe(true);
  });
});
