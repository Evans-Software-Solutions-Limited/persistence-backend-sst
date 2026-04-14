import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Divider } from "../Divider";

describe("Divider", () => {
  it("renders horizontal by default", () => {
    const { UNSAFE_root } = renderWithTheme(<Divider testID="divider" />);
    expect(UNSAFE_root).toBeTruthy();
  });

  it("renders vertical orientation", () => {
    const { UNSAFE_root } = renderWithTheme(<Divider orientation="vertical" />);
    expect(UNSAFE_root).toBeTruthy();
  });

  it("renders with spacing variant", () => {
    const { UNSAFE_root } = renderWithTheme(<Divider spacing="md" />);
    expect(UNSAFE_root).toBeTruthy();
  });

  it("renders with testID", () => {
    const { getByTestId } = renderWithTheme(<Divider testID="divider" />);
    expect(getByTestId("divider")).toBeTruthy();
  });
});
