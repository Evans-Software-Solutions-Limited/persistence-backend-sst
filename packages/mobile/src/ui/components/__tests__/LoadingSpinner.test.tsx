import { renderWithTheme } from "../../../../__tests__/test-utils";
import { LoadingSpinner } from "../LoadingSpinner";

describe("LoadingSpinner", () => {
  it("renders with default size", () => {
    const { getByTestId } = renderWithTheme(
      <LoadingSpinner testID="spinner" />,
    );
    expect(getByTestId("spinner")).toBeTruthy();
  });

  it("renders sm size", () => {
    const { getByTestId } = renderWithTheme(
      <LoadingSpinner size="sm" testID="spinner" />,
    );
    expect(getByTestId("spinner")).toBeTruthy();
  });

  it("renders lg size", () => {
    const { getByTestId } = renderWithTheme(
      <LoadingSpinner size="lg" testID="spinner" />,
    );
    expect(getByTestId("spinner").props.size).toBe("large");
  });

  it("has loading accessibility label", () => {
    const { getByTestId } = renderWithTheme(
      <LoadingSpinner testID="spinner" />,
    );
    expect(getByTestId("spinner").props.accessibilityLabel).toBe("Loading");
  });
});
