import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Text } from "../../Text";
import { BottomSheet, type BottomSheetAccent } from "../BottomSheet";

const ACCENTS: BottomSheetAccent[] = ["primary", "gold", "trainer", "ember"];

describe("BottomSheet", () => {
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
