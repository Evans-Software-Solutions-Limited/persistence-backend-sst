import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { RingLegend } from "../RingLegend";

describe("RingLegend", () => {
  it("renders label, value, and computed percent", () => {
    const { getByText } = renderWithTheme(
      <RingLegend color="#22D3EE" label="Move" value="540" pct={0.74} />,
    );
    expect(getByText("Move")).toBeTruthy();
    expect(getByText("540")).toBeTruthy();
    expect(getByText("74%")).toBeTruthy();
  });

  it("renders an optional sub line", () => {
    const { getByText } = renderWithTheme(
      <RingLegend
        color="#F5C518"
        label="Train"
        value="12.4k"
        sub="kg lifted"
        pct={0.42}
      />,
    );
    expect(getByText("kg lifted")).toBeTruthy();
  });

  it("clamps percent to 0-100", () => {
    const { getByText: hi } = renderWithTheme(
      <RingLegend color="#fff" label="X" value="1" pct={1.4} />,
    );
    expect(hi("100%")).toBeTruthy();
    const { getByText: lo } = renderWithTheme(
      <RingLegend color="#fff" label="Y" value="1" pct={-0.2} />,
    );
    expect(lo("0%")).toBeTruthy();
  });

  it("composes an accessibilityLabel from label + value + percent", () => {
    const { getByTestId } = renderWithTheme(
      <RingLegend
        color="#22D3EE"
        label="Move"
        value="540"
        pct={0.74}
        testID="legend"
      />,
    );
    expect(getByTestId("legend").props.accessibilityLabel).toBe("Move 540 74%");
  });

  it("renders the value in the mono family", () => {
    const { getByText } = renderWithTheme(
      <RingLegend color="#22D3EE" label="Move" value="540" pct={0.74} />,
    );
    const value = getByText("540");
    const flat = Array.isArray(value.props.style)
      ? Object.assign({}, ...value.props.style)
      : value.props.style;
    expect(String(flat.fontFamily ?? "")).toMatch(/mono/i);
  });
});
