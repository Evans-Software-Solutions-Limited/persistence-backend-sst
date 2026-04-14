import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Skeleton } from "../Skeleton";

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: "LinearGradient",
}));

describe("Skeleton", () => {
  it("renders rect variant by default", () => {
    const { getByTestId } = renderWithTheme(<Skeleton testID="skeleton" />);
    expect(getByTestId("skeleton")).toBeTruthy();
  });

  it("renders text variant", () => {
    const { getByTestId } = renderWithTheme(
      <Skeleton variant="text" testID="skeleton" />,
    );
    expect(getByTestId("skeleton")).toBeTruthy();
  });

  it("renders circle variant", () => {
    const { getByTestId } = renderWithTheme(
      <Skeleton variant="circle" testID="skeleton" />,
    );
    expect(getByTestId("skeleton")).toBeTruthy();
  });

  it("renders with custom width and height", () => {
    const { getByTestId } = renderWithTheme(
      <Skeleton width={200} height={50} testID="skeleton" />,
    );
    expect(getByTestId("skeleton")).toBeTruthy();
  });

  it("has loading accessibility label", () => {
    const { getByTestId } = renderWithTheme(<Skeleton testID="skeleton" />);
    expect(getByTestId("skeleton").props.accessibilityLabel).toBe("Loading");
  });
});
