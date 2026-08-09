import { renderWithTheme } from "../../../../__tests__/test-utils";
import { LoadingSpinner } from "../LoadingSpinner";

describe("LoadingSpinner", () => {
  it.each([
    ["sm", 18],
    ["md", 24],
    ["lg", 40],
  ] as const)(
    "keeps the %s loader inside fixed %dpx bounds",
    (size, pixels) => {
      const { getByTestId } = renderWithTheme(
        <LoadingSpinner size={size} testID="spinner" />,
      );
      expect(getByTestId("spinner").props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ width: pixels, height: pixels }),
        ]),
      );
    },
  );

  it("has loading accessibility label", () => {
    const { getByTestId } = renderWithTheme(
      <LoadingSpinner testID="spinner" />,
    );
    expect(getByTestId("spinner").props.accessibilityLabel).toBe("Loading");
    expect(getByTestId("spinner").props.accessibilityRole).toBe("progressbar");
  });
});
