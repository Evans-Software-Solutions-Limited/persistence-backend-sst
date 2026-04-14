import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Badge } from "../Badge";

describe("Badge", () => {
  it("renders with label", () => {
    const { getByText } = renderWithTheme(<Badge label="3" />);
    expect(getByText("3")).toBeTruthy();
  });

  it("renders all variant types", () => {
    const variants = [
      "default",
      "success",
      "warning",
      "error",
      "info",
      "primary",
    ] as const;
    for (const variant of variants) {
      const { getByText } = renderWithTheme(
        <Badge label={variant} variant={variant} />,
      );
      expect(getByText(variant)).toBeTruthy();
    }
  });

  it("renders sm and md sizes", () => {
    const { getByText: getSmall } = renderWithTheme(
      <Badge label="S" size="sm" />,
    );
    expect(getSmall("S")).toBeTruthy();

    const { getByText: getMedium } = renderWithTheme(
      <Badge label="M" size="md" />,
    );
    expect(getMedium("M")).toBeTruthy();
  });

  it("renders with testID", () => {
    const { getByTestId } = renderWithTheme(<Badge label="1" testID="badge" />);
    expect(getByTestId("badge")).toBeTruthy();
  });
});
