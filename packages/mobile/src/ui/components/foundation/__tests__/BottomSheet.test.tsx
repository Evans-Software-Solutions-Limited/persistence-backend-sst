import GorhomBottomSheet, {
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { within } from "@testing-library/react-native";
import { Dimensions, StyleSheet } from "react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Text } from "../../Text";
import { BottomSheet, type BottomSheetAccent } from "../BottomSheet";

// Toggle the reduce-motion gate per-test so we can assert the snap-vs-slide
// contract (spec-12.2 AC 3.3) without driving the OS setting through reanimated
// (the gate has its own unit test).
let mockSheetAnimation: "slide" | "snap" = "slide";
jest.mock("@/ui/hooks/useReducedMotionGate", () => ({
  useReducedMotionGate: () => ({
    reduced: mockSheetAnimation === "snap",
    ringFillMs: 0,
    barFillMs: 0,
    sheetAnimation: mockSheetAnimation,
    pulseDots: mockSheetAnimation === "slide",
    tabAccentMs: 0,
  }),
}));

const ACCENTS: BottomSheetAccent[] = ["primary", "gold", "trainer", "ember"];

describe("BottomSheet", () => {
  afterEach(() => {
    mockSheetAnimation = "slide";
  });

  it("slides (no snap override) when reduce-motion is off", () => {
    const { UNSAFE_getByType } = renderWithTheme(
      <BottomSheet visible onClose={() => undefined} title="Scan">
        <Text>x</Text>
      </BottomSheet>,
    );
    // No animationConfigs → gorhom uses its default slide timing.
    expect(
      UNSAFE_getByType(GorhomBottomSheet).props.animationConfigs,
    ).toBeUndefined();
  });

  it("snaps (zero-duration animation) when reduce-motion is on (AC 3.3)", () => {
    mockSheetAnimation = "snap";
    const { UNSAFE_getByType } = renderWithTheme(
      <BottomSheet visible onClose={() => undefined} title="Scan">
        <Text>x</Text>
      </BottomSheet>,
    );
    expect(UNSAFE_getByType(GorhomBottomSheet).props.animationConfigs).toEqual({
      duration: 0,
    });
  });

  it("renders nothing when not visible", () => {
    const { queryByTestId, queryByText } = renderWithTheme(
      <BottomSheet visible={false} onClose={() => undefined} title="Scan">
        <Text>Body</Text>
      </BottomSheet>,
    );
    expect(queryByText("Body")).toBeNull();
    expect(queryByTestId("gorhom-bottom-sheet")).toBeNull();
  });

  it("renders the title, eyebrow, and children when visible", () => {
    const { getByText } = renderWithTheme(
      <BottomSheet
        visible
        onClose={() => undefined}
        eyebrow="QUICK ADD"
        title="Log Water"
      >
        <Text>Sheet body</Text>
      </BottomSheet>,
    );
    expect(getByText("QUICK ADD")).toBeTruthy();
    expect(getByText("Log Water")).toBeTruthy();
    expect(getByText("Sheet body")).toBeTruthy();
  });

  // Regression guard for the drawer-scroll bug (2026-07-29). The sheet body MUST
  // carry a definite pixel height; with `flex: 1` it inherited none from
  // gorhom's content view, so the inner scroll view's viewport equalled its
  // content and nothing below the fold could be reached — verified on an iPhone
  // 17 Pro simulator, where even a plain RN ScrollView would not scroll. Jest
  // renders gorhom as plain Views so this cannot prove scrolling; it pins the
  // one property the fix depends on, which reading the diff cannot.
  it.each(
    /** [height prop, expected fraction of the window] */
    [
      ["peek", 0.6],
      ["default", 0.78],
      ["tall", 0.88],
      [50, 0.5],
    ] as const,
  )(
    "gives the sheet body a definite height for height=%s",
    (height, fraction) => {
      const { getByTestId } = renderWithTheme(
        <BottomSheet
          visible
          onClose={() => {}}
          height={height}
          testID="sheet-body"
        >
          <Text>body</Text>
        </BottomSheet>,
      );
      const style = StyleSheet.flatten(getByTestId("sheet-body").props.style);
      const windowHeight = Dimensions.get("window").height;
      // 24 = gorhom's handle (10pt padding either side of a 4pt indicator).
      expect(style.height).toBeCloseTo(windowHeight * fraction - 24, 1);
      // The bug: a flex basis with no definite height.
      expect(style.flex).toBeUndefined();
    },
  );

  it("renders the sheet container via the gorhom mock when visible", () => {
    const { getByTestId } = renderWithTheme(
      <BottomSheet
        visible
        onClose={() => undefined}
        title="Scan"
        testID="sheet"
      >
        <Text>x</Text>
      </BottomSheet>,
    );
    expect(getByTestId("gorhom-bottom-sheet")).toBeTruthy();
    expect(getByTestId("sheet")).toBeTruthy();
  });

  it.each(ACCENTS)("renders accent %s", (accent) => {
    const { getByText } = renderWithTheme(
      <BottomSheet visible onClose={() => undefined} accent={accent} title="A">
        <Text>{`body-${accent}`}</Text>
      </BottomSheet>,
    );
    expect(getByText(`body-${accent}`)).toBeTruthy();
  });

  it.each(["peek", "default", "tall", 90] as const)(
    "renders height %s",
    (height) => {
      const { getByText } = renderWithTheme(
        <BottomSheet
          visible
          onClose={() => undefined}
          height={height}
          title="H"
        >
          <Text>{`h-${height}`}</Text>
        </BottomSheet>,
      );
      expect(getByText(`h-${height}`)).toBeTruthy();
    },
  );

  it("renders a header-less sheet (children only)", () => {
    const { getByText } = renderWithTheme(
      <BottomSheet visible onClose={() => undefined}>
        <Text>just body</Text>
      </BottomSheet>,
    );
    expect(getByText("just body")).toBeTruthy();
  });

  // The `footer` region exists so a commit action cannot scroll below the fold.
  // Jest renders gorhom as plain Views, so these pin the STRUCTURE (footer is a
  // sibling of the scroll body, not a child of it) — the thing reading the diff
  // cannot confirm and the thing a regression would silently undo.
  describe("footer", () => {
    it("renders no footer region when none is supplied", () => {
      const { queryByTestId } = renderWithTheme(
        <BottomSheet visible onClose={() => undefined} title="Scan">
          <Text>body</Text>
        </BottomSheet>,
      );
      expect(queryByTestId("bottom-sheet-footer")).toBeNull();
    });

    it("renders the footer OUTSIDE the scrolling body", () => {
      const { getByTestId, UNSAFE_getByType } = renderWithTheme(
        <BottomSheet
          visible
          onClose={() => undefined}
          title="Scan"
          footer={<Text testID="the-cta">Commit</Text>}
        >
          <Text testID="the-body">body</Text>
        </BottomSheet>,
      );
      // The CTA is inside the footer region…
      expect(
        within(getByTestId("bottom-sheet-footer")).getByTestId("the-cta"),
      ).toBeTruthy();

      // …and that region is NOT a descendant of the scroll view, while the
      // children are. This is the assertion that matters: wrapping the footer in
      // a <View testID="bottom-sheet-footer"> INSIDE the scroll view satisfies
      // the check above but reintroduces the whole bug.
      const scroll = UNSAFE_getByType(BottomSheetScrollView);
      expect(within(scroll).getByTestId("the-body")).toBeTruthy();
      expect(within(scroll).queryByTestId("bottom-sheet-footer")).toBeNull();
      expect(within(scroll).queryByTestId("the-cta")).toBeNull();
    });

    it("moves the bottom safe-area inset from the scroll content to the footer", () => {
      // Paying the inset in both places opens a dead band of scroll above the
      // pinned action; paying it in neither puts the action under the home
      // indicator.
      const without = renderWithTheme(
        <BottomSheet visible onClose={() => undefined}>
          <Text>body</Text>
        </BottomSheet>,
      );
      const noFooterPad = StyleSheet.flatten(
        without.UNSAFE_getByType(BottomSheetScrollView).props
          .contentContainerStyle,
      ).paddingBottom as number;
      // Whatever the harness's inset is, the footer-less body carries it.
      const inset = noFooterPad - 40;
      expect(inset).toBeGreaterThan(0);

      const withFooter = renderWithTheme(
        <BottomSheet
          visible
          onClose={() => undefined}
          footer={<Text>Commit</Text>}
        >
          <Text>body</Text>
        </BottomSheet>,
      );
      // Scroll content drops the inset entirely…
      expect(
        StyleSheet.flatten(
          withFooter.UNSAFE_getByType(BottomSheetScrollView).props
            .contentContainerStyle,
        ).paddingBottom,
      ).toBe(24);
      // …and the footer picks it up, so the action still clears the home
      // indicator.
      expect(
        StyleSheet.flatten(
          withFooter.getByTestId("bottom-sheet-footer").props.style,
        ).paddingBottom,
      ).toBe(12 + inset);
    });
  });

  it("keeps the sheet mounted across a parent-driven visible:true->false so it animates DOWN (PR #83 Lead 6)", () => {
    // Open, then flip visible to false via re-render. The sheet must NOT
    // unmount synchronously (which would null the ref and snap shut) — it stays
    // mounted at index=-1 so gorhom's close() animation can run.
    const { rerender, queryByTestId } = renderWithTheme(
      <BottomSheet visible onClose={() => undefined} testID="sheet">
        <Text>body</Text>
      </BottomSheet>,
    );
    expect(queryByTestId("gorhom-bottom-sheet")).toBeTruthy();
    rerender(
      <BottomSheet visible={false} onClose={() => undefined} testID="sheet">
        <Text>body</Text>
      </BottomSheet>,
    );
    // Still mounted after the close request (drives close() animation rather
    // than an instant unmount).
    expect(queryByTestId("gorhom-bottom-sheet")).toBeTruthy();
  });
});
