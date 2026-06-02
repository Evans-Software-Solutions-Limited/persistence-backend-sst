import { fireEvent } from "@testing-library/react-native";
import { View } from "react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Btn, type BtnSize, type BtnTone, type BtnVariant } from "../Btn";

/** Icon stub that surfaces the `color` it was rendered with (via
 * accessibilityLabel) so tests can assert <Btn>'s icon tint. */
function ColorProbe({ color }: { color?: string }) {
  return <View testID="probe-icon" accessibilityLabel={color ?? "none"} />;
}

const VARIANTS: BtnVariant[] = ["filled", "outline", "ghost", "soft"];
const TONES: BtnTone[] = [
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];
const SIZES: BtnSize[] = ["sm", "md", "lg"];

describe("Btn", () => {
  it("renders its label and fires onPress", () => {
    const onPress = jest.fn();
    const { getByText } = renderWithTheme(<Btn onPress={onPress}>Start</Btn>);
    fireEvent.press(getByText("Start"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders the full variant × tone matrix without throwing", () => {
    for (const variant of VARIANTS) {
      for (const tone of TONES) {
        const { getByText } = renderWithTheme(
          <Btn variant={variant} tone={tone} onPress={() => undefined}>
            {`${variant}-${tone}`}
          </Btn>,
        );
        expect(getByText(`${variant}-${tone}`)).toBeTruthy();
      }
    }
  });

  it.each(SIZES)("renders size %s with the right min-height floor", (size) => {
    const expectedHeight = size === "sm" ? 36 : size === "lg" ? 52 : 44;
    const { getByTestId } = renderWithTheme(
      <Btn size={size} onPress={() => undefined} testID={`btn-${size}`}>
        x
      </Btn>,
    );
    const pressable = getByTestId(`btn-${size}`);
    const flat = Array.isArray(pressable.props.style)
      ? Object.assign({}, ...pressable.props.style)
      : pressable.props.style;
    expect(flat.minHeight).toBe(expectedHeight);
  });

  it("defaults to a 44pt min-height (Apple HIG floor)", () => {
    const { getByTestId } = renderWithTheme(
      <Btn onPress={() => undefined} testID="btn">
        x
      </Btn>,
    );
    const flat = Array.isArray(getByTestId("btn").props.style)
      ? Object.assign({}, ...getByTestId("btn").props.style)
      : getByTestId("btn").props.style;
    expect(flat.minHeight).toBe(44);
  });

  it("does not fire onPress when disabled + reflects disabled a11y state", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Btn onPress={onPress} disabled testID="btn">
        x
      </Btn>,
    );
    const pressable = getByTestId("btn");
    fireEvent.press(pressable);
    expect(onPress).not.toHaveBeenCalled();
    expect(pressable.props.accessibilityState.disabled).toBe(true);
  });

  it("forwards accessibilityLabel + role", () => {
    const { getByTestId } = renderWithTheme(
      <Btn
        onPress={() => undefined}
        accessibilityLabel="Begin set"
        testID="btn"
      >
        Go
      </Btn>,
    );
    const pressable = getByTestId("btn");
    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("Begin set");
  });

  it("renders an icon slot", () => {
    const { getByTestId } = renderWithTheme(
      <Btn
        onPress={() => undefined}
        icon={<View testID="btn-icon" />}
        testID="btn"
      >
        Add
      </Btn>,
    );
    expect(getByTestId("btn-icon")).toBeTruthy();
  });

  it("tints the icon to the foreground colour (non-filled uses the tone base)", () => {
    const { getByTestId } = renderWithTheme(
      <Btn
        onPress={() => undefined}
        variant="soft"
        tone="primary"
        icon={<ColorProbe />}
      >
        Create
      </Btn>,
    );
    // soft/outline/ghost label colour is the tone base; the icon must match.
    expect(getByTestId("probe-icon").props.accessibilityLabel).toBe("#22D3EE");
  });

  it("preserves a caller-set concrete icon colour", () => {
    const { getByTestId } = renderWithTheme(
      <Btn onPress={() => undefined} icon={<ColorProbe color="#abcabc" />}>
        Go
      </Btn>,
    );
    expect(getByTestId("probe-icon").props.accessibilityLabel).toBe("#abcabc");
  });

  it("stretches when full", () => {
    const { getByTestId } = renderWithTheme(
      <Btn onPress={() => undefined} full testID="btn">
        Wide
      </Btn>,
    );
    const flat = Array.isArray(getByTestId("btn").props.style)
      ? Object.assign({}, ...getByTestId("btn").props.style)
      : getByTestId("btn").props.style;
    expect(flat.width).toBe("100%");
  });
});
