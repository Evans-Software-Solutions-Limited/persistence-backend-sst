import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Pill, type PillSize } from "../Pill";
import type { PillTone } from "../tones";

const TONES: PillTone[] = [
  "neutral",
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];
const SIZES: PillSize[] = ["xs", "sm", "md"];

describe("Pill", () => {
  it("renders its label uppercased on a single line", () => {
    const { getByText } = renderWithTheme(<Pill>new pr</Pill>);
    const label = getByText("new pr");
    const flat = Array.isArray(label.props.style)
      ? Object.assign({}, ...label.props.style)
      : label.props.style;
    expect(flat.textTransform).toBe("uppercase");
    expect(label.props.numberOfLines).toBe(1);
  });

  it.each(TONES)("renders tone %s", (tone) => {
    const { getByText } = renderWithTheme(<Pill tone={tone}>{tone}</Pill>);
    expect(getByText(tone)).toBeTruthy();
  });

  it.each(SIZES)("renders size %s", (size) => {
    const { getByText } = renderWithTheme(
      <Pill size={size}>{`size-${size}`}</Pill>,
    );
    expect(getByText(`size-${size}`)).toBeTruthy();
  });

  it("renders filled variant for each tone", () => {
    for (const tone of TONES) {
      const { getByText } = renderWithTheme(
        <Pill tone={tone} filled>
          {`f-${tone}`}
        </Pill>,
      );
      expect(getByText(`f-${tone}`)).toBeTruthy();
    }
  });

  it("never shrinks in a dense row (flexShrink 0)", () => {
    const { getByTestId } = renderWithTheme(<Pill testID="pill">badge</Pill>);
    const flat = Array.isArray(getByTestId("pill").props.style)
      ? Object.assign({}, ...getByTestId("pill").props.style)
      : getByTestId("pill").props.style;
    expect(flat.flexShrink).toBe(0);
  });

  it("forwards accessibilityLabel", () => {
    const { getByTestId } = renderWithTheme(
      <Pill testID="pill" accessibilityLabel="New personal record">
        PR
      </Pill>,
    );
    expect(getByTestId("pill").props.accessibilityLabel).toBe(
      "New personal record",
    );
  });
});
