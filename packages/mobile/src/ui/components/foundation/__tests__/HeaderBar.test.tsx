import { View } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { HeaderBar } from "../HeaderBar";

describe("HeaderBar", () => {
  it("renders a compact centred title", () => {
    const { getByText } = renderWithTheme(
      <HeaderBar title="Workout" testID="hb" />,
    );
    expect(getByText("Workout")).toBeTruthy();
  });

  it("renders leading + trailing slots", () => {
    const { getByTestId } = renderWithTheme(
      <HeaderBar
        title="Workout"
        leading={<View testID="lead" />}
        trailing={<View testID="trail" />}
      />,
    );
    expect(getByTestId("lead")).toBeTruthy();
    expect(getByTestId("trail")).toBeTruthy();
  });

  it("renders the large variant with eyebrow + title + sub", () => {
    const { getByText } = renderWithTheme(
      <HeaderBar
        large
        eyebrow="MONDAY · MAR 25"
        title="Fuel"
        sub="2 meals logged"
      />,
    );
    expect(getByText("MONDAY · MAR 25")).toBeTruthy();
    expect(getByText("Fuel")).toBeTruthy();
    expect(getByText("2 meals logged")).toBeTruthy();
  });

  it("does not render a centred title in large mode (title is the display heading)", () => {
    const { getAllByText } = renderWithTheme(<HeaderBar large title="Fuel" />);
    // Only one "Fuel" — the large display title, not a duplicated compact one.
    expect(getAllByText("Fuel")).toHaveLength(1);
  });

  it("renders with no title (slots-only header)", () => {
    const { getByTestId } = renderWithTheme(
      <HeaderBar testID="hb" leading={<View testID="lead" />} />,
    );
    expect(getByTestId("hb")).toBeTruthy();
    expect(getByTestId("lead")).toBeTruthy();
  });

  it("renders large mode without an eyebrow or sub", () => {
    const { getByText } = renderWithTheme(<HeaderBar large title="You" />);
    expect(getByText("You")).toBeTruthy();
  });
});
