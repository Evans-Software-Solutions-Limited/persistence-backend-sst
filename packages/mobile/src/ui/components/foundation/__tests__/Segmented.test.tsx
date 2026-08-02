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

  it.each([320, 375, 420])(
    "auto-scrolls with >=4 options at %ipt — no width gate (AC 3.7)",
    (width) => {
      setViewport(width);
      const { getByTestId } = renderWithTheme(
        <Segmented
          testID="seg"
          options={["A", "B", "C", "D"]}
          value="A"
          onChange={() => undefined}
        />,
      );
      expect(getByTestId("seg-scroll")).toBeTruthy();
    },
  );
});

/**
 * ⚠ This replaced a test asserting the OPPOSITE at 420pt, which pinned the
 * `width < 360` gate. The Train hub gained a fourth `Gyms` segment on 2026-08-02:
 * "Training Workouts Exercises Gyms" is ~320pt of content plus padding, so every
 * phone from 360pt up to the track's real width clipped instead of scrolling,
 * with no way to reach the last segment. A 375pt iPhone SE sat inside that band.
 *
 * The gate is gone rather than retuned because the number it needed depends on
 * font, locale and the user's Dynamic Type setting — none of which a constant can
 * know. An unnecessary horizontal ScrollView is inert, so the safe answer is
 * always-scrollable, and the old assertion was pinning the bug.
 *
 * ⚠ The Train hub was NOT the first 4-option consumer — `MealPickerPresenter`
 * already fed in the four `MEAL_SLOTS` and rendered inside three bottom sheets,
 * taking the scrolling path below 360pt. So this widened an existing path rather
 * than lighting up a dead one; the sheets were re-checked on device.
 */
