import { fireEvent } from "@testing-library/react-native";
import { useWindowDimensions } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Segmented, type SegmentedAccent } from "../Segmented";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const ACCENTS: SegmentedAccent[] = ["primary", "gold", "trainer"];

function setViewport(width: number) {
  (useWindowDimensions as jest.Mock).mockReturnValue({
    width,
    height: 800,
    scale: 2,
    fontScale: 1,
  });
}

describe("Segmented", () => {
  beforeEach(() => setViewport(390));

  it("renders string options and fires onChange with the value", () => {
    const onChange = jest.fn();
    const { getByText } = renderWithTheme(
      <Segmented
        options={["Workouts", "Exercises"]}
        value="Workouts"
        onChange={onChange}
      />,
    );
    fireEvent.press(getByText("Exercises"));
    expect(onChange).toHaveBeenCalledWith("Exercises");
  });

  it("renders {value,label} options and reports the active tab via a11y", () => {
    const { getByTestId } = renderWithTheme(
      <Segmented
        testID="seg"
        options={[
          { value: "active", label: "Active" },
          { value: "all", label: "All" },
          { value: "archive", label: "Archive" },
        ]}
        value="all"
        onChange={() => undefined}
      />,
    );
    expect(
      getByTestId("seg-option-all").props.accessibilityState.selected,
    ).toBe(true);
    expect(
      getByTestId("seg-option-active").props.accessibilityState.selected,
    ).toBe(false);
  });

  it("supports 2-5 options (locked decision #9)", () => {
    for (const n of [2, 3, 4, 5]) {
      const options = Array.from({ length: n }, (_, i) => `Opt${i}`);
      const { getByText } = renderWithTheme(
        <Segmented options={options} value="Opt0" onChange={() => undefined} />,
      );
      expect(getByText(`Opt${n - 1}`)).toBeTruthy();
    }
  });

  it.each(ACCENTS)("renders accent %s", (accent) => {
    const { getByText } = renderWithTheme(
      <Segmented
        options={["A", "B"]}
        value="A"
        accent={accent}
        onChange={() => undefined}
      />,
    );
    expect(getByText("A")).toBeTruthy();
  });

  it("renders the sm size", () => {
    const { getByText } = renderWithTheme(
      <Segmented
        options={["A", "B"]}
        value="A"
        size="sm"
        onChange={() => undefined}
      />,
    );
    expect(getByText("B")).toBeTruthy();
  });

  it("does NOT auto-scroll with 3 options on a narrow viewport", () => {
    setViewport(320);
    const { queryByTestId } = renderWithTheme(
      <Segmented
        testID="seg"
        options={["A", "B", "C"]}
        value="A"
        onChange={() => undefined}
      />,
    );
    expect(queryByTestId("seg-scroll")).toBeNull();
  });

  it("auto-scrolls with >=4 options on a narrow (<360) viewport (AC 3.7)", () => {
    setViewport(320);
    const { getByTestId } = renderWithTheme(
      <Segmented
        testID="seg"
        options={["A", "B", "C", "D"]}
        value="A"
        onChange={() => undefined}
      />,
    );
    expect(getByTestId("seg-scroll")).toBeTruthy();
  });

  it("does NOT auto-scroll with >=4 options on a wide viewport", () => {
    setViewport(420);
    const { queryByTestId } = renderWithTheme(
      <Segmented
        testID="seg"
        options={["A", "B", "C", "D"]}
        value="A"
        onChange={() => undefined}
      />,
    );
    expect(queryByTestId("seg-scroll")).toBeNull();
  });
});
