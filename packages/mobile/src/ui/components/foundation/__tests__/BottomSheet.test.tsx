import GorhomBottomSheet from "@gorhom/bottom-sheet";
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
