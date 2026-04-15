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
});
