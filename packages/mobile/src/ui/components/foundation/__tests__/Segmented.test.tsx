import { act, fireEvent } from "@testing-library/react-native";
import { ScrollView, useWindowDimensions } from "react-native";

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

/** Fire a segment's `onLayout` with a measured x, as the native side would. */
function layout(node: { props: Record<string, unknown> }, x: number) {
  act(() => {
    (node.props.onLayout as (e: unknown) => void)({
      nativeEvent: { layout: { x, y: 0, width: 60, height: 32 } },
    });
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

  it.each([2, 3, 4, 5])(
    "wraps a %i-option track in the scroller — no count gate either",
    (count) => {
      setViewport(320);
      const options = ["A", "B", "C", "D", "E"].slice(0, count);
      const { getByTestId } = renderWithTheme(
        <Segmented
          testID="seg"
          options={options}
          value="A"
          onChange={() => undefined}
        />,
      );
      // ⚠ Was `options.length >= 4`, which left the 3-option sets clipping at
      // large Dynamic Type with no way to reach the trailing segment — the same
      // species of guess about text metrics as the `width < 360` gate before it.
      // The Train hub's no-coach set went 2 → 3 options when `Gyms` was added,
      // which is what made `Gyms` the one that vanished.
      expect(getByTestId("seg-scroll")).toBeTruthy();
    },
  );

  /**
   * ⚠ These two pin the scroll-into-view, which a first attempt implemented as an
   * effect and which therefore never fired on mount: offsets live in a ref (they
   * must not re-render), so an effect running after the first commit reads an empty
   * map, returns early and never re-runs. The cold-launch case — a persisted
   * `Gyms` segment whose pill is off-screen, reading as a switcher with nothing
   * selected — stayed broken while the docblock said it was fixed.
   */
  it("scrolls the ACTIVE option into view from its own first layout", () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
    try {
      const { getByTestId } = renderWithTheme(
        <Segmented
          testID="seg"
          options={["A", "B", "C", "D"]}
          value="D"
          onChange={() => undefined}
        />,
      );

      // Nothing has been measured yet, so nothing can be positioned yet.
      expect(scrollTo).not.toHaveBeenCalled();

      layout(getByTestId("seg-option-A"), 0);
      layout(getByTestId("seg-option-D"), 275);

      // Not animated: this is where the track should have STARTED.
      expect(scrollTo).toHaveBeenCalledWith({ x: 263, animated: false });
    } finally {
      scrollTo.mockRestore();
    }
  });

  it("re-measures when the option SET changes instead of trusting stale offsets", () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
    try {
      // The Train hub's own coach gate does exactly this: a non-Training segment
      // renders 3 options while `useClientRelationships` loads, then a 4th appears
      // when it resolves to coached — at which point every offset has moved.
      const { getByTestId, rerender } = renderWithTheme(
        <Segmented
          testID="seg"
          options={["B", "C", "D"]}
          value="D"
          onChange={() => undefined}
        />,
      );
      layout(getByTestId("seg-option-D"), 185);
      scrollTo.mockClear();

      rerender(
        <Segmented
          testID="seg"
          options={["A", "B", "C", "D"]}
          value="D"
          onChange={() => undefined}
        />,
      );
      // The 3-option offset must NOT be reused — it is short by a whole segment.
      expect(scrollTo).not.toHaveBeenCalledWith({ x: 173, animated: false });

      layout(getByTestId("seg-option-D"), 275);
      expect(scrollTo).toHaveBeenCalledWith({ x: 263, animated: false });
    } finally {
      scrollTo.mockRestore();
    }
  });

  it.each([320, 375, 420])(
    "auto-scrolls at %ipt — no width gate either (AC 3.7)",
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
