import { renderWithTheme } from "../../../../__tests__/test-utils";
import { PLogoDrawLoader } from "../PLogoDrawLoader";

describe("PLogoDrawLoader", () => {
  it("renders with default props", () => {
    const { getByTestId } = renderWithTheme(<PLogoDrawLoader />);
    expect(getByTestId("logo-loader")).toBeTruthy();
  });

  it("renders with custom testID", () => {
    const { getByTestId } = renderWithTheme(
      <PLogoDrawLoader testID="custom-loader" />,
    );
    expect(getByTestId("custom-loader")).toBeTruthy();
  });

  it("accepts custom size and color props", () => {
    const { getByTestId } = renderWithTheme(
      <PLogoDrawLoader size={100} color="#FF0000" />,
    );
    expect(getByTestId("logo-loader")).toBeTruthy();
  });

  it("supports compact inline rendering without outer padding", () => {
    const { getByTestId } = renderWithTheme(
      <PLogoDrawLoader size={24} containerPadding={0} />,
    );
    expect(getByTestId("logo-loader").props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 24, height: 24 }),
      ]),
    );
  });

  it("exposes an accessible indeterminate progress state", () => {
    const { getByRole } = renderWithTheme(<PLogoDrawLoader />);
    expect(getByRole("progressbar").props.accessibilityLabel).toBe("Loading");
  });

  it("can hide its semantics when an enclosing progress region owns them", () => {
    const { getByTestId, queryByRole } = renderWithTheme(
      <PLogoDrawLoader accessible={false} />,
    );
    expect(queryByRole("progressbar")).toBeNull();
    expect(
      getByTestId("logo-loader", { includeHiddenElements: true }).props
        .importantForAccessibility,
    ).toBe("no-hide-descendants");
  });

  it.each([0, -10, Number.NaN])(
    "clamps invalid size %p to finite positive dimensions",
    (size) => {
      const { getByTestId } = renderWithTheme(
        <PLogoDrawLoader size={size} containerPadding={0} />,
      );
      expect(getByTestId("logo-loader").props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ width: 1, height: 1 }),
        ]),
      );
    },
  );
});
