import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Stat, type StatSize, type StatTone } from "../Stat";

const TONES: StatTone[] = ["text", "primary", "gold", "trainer", "ember"];
const SIZES: StatSize[] = ["md", "lg", "xl"];

const flatten = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return (style as Record<string, unknown>) ?? {};
};

describe("Stat", () => {
  it("renders the value in the mono family with tabular figures", () => {
    const { getByTestId } = renderWithTheme(
      <Stat value={1234} testID="stat" />,
    );
    const value = getByTestId("stat-value");
    expect(JSON.stringify(value.props)).toContain("tabular-nums");
    const flat = flatten(value.props.style);
    expect(String(flat.fontFamily ?? "")).toMatch(/mono/i);
  });

  it("renders value, unit, label, and sub", () => {
    const { getByText } = renderWithTheme(
      <Stat value="120" unit="KG" label="Bench" sub="last week" />,
    );
    expect(getByText("120")).toBeTruthy();
    expect(getByText("KG")).toBeTruthy();
    expect(getByText("Bench")).toBeTruthy();
    expect(getByText("last week")).toBeTruthy();
  });

  it("renders an up trend in success colour with ▲", () => {
    const { getByTestId } = renderWithTheme(
      <Stat value={100} trend={12} testID="stat" />,
    );
    const trend = getByTestId("stat-trend");
    expect(trend.props.children).toBe("▲ 12%");
  });

  it("renders a down trend in error colour with ▼", () => {
    const { getByTestId } = renderWithTheme(
      <Stat value={100} trend={-8} testID="stat" />,
    );
    expect(getByTestId("stat-trend").props.children).toBe("▼ 8%");
  });

  it("omits the trend element when trend is 0 or undefined", () => {
    const { queryByTestId } = renderWithTheme(
      <Stat value={100} trend={0} testID="stat" />,
    );
    expect(queryByTestId("stat-trend")).toBeNull();
  });

  it.each(TONES)("renders tone %s", (tone) => {
    const { getByTestId } = renderWithTheme(
      <Stat value={1} tone={tone} testID="stat" />,
    );
    expect(getByTestId("stat-value")).toBeTruthy();
  });

  it.each(SIZES)(
    "renders size %s with the matching value font-size",
    (size) => {
      const expected = size === "md" ? 20 : size === "lg" ? 28 : 40;
      const { getByTestId } = renderWithTheme(
        <Stat value={9} size={size} testID="stat" />,
      );
      const flat = flatten(getByTestId("stat-value").props.style);
      expect(flat.fontSize).toBe(expected);
    },
  );

  it("renders centered alignment", () => {
    const { getByTestId } = renderWithTheme(
      <Stat value={9} align="center" testID="stat" />,
    );
    expect(getByTestId("stat")).toBeTruthy();
  });
});
