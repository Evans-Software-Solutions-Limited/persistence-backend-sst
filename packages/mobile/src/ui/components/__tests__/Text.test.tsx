import { renderWithTheme } from "../../../../__tests__/test-utils";
import { Text } from "../Text";

describe("Text", () => {
  it("renders with default body variant", () => {
    const { getByText } = renderWithTheme(<Text>Hello world</Text>);
    expect(getByText("Hello world")).toBeTruthy();
  });

  it("renders h1 variant", () => {
    const { getByText } = renderWithTheme(<Text variant="h1">Heading</Text>);
    expect(getByText("Heading")).toBeTruthy();
  });

  it("renders h2 variant", () => {
    const { getByText } = renderWithTheme(<Text variant="h2">Subheading</Text>);
    expect(getByText("Subheading")).toBeTruthy();
  });

  it("renders caption variant", () => {
    const { getByText } = renderWithTheme(
      <Text variant="caption">Small text</Text>,
    );
    expect(getByText("Small text")).toBeTruthy();
  });

  it("renders label variant", () => {
    const { getByText } = renderWithTheme(<Text variant="label">Label</Text>);
    expect(getByText("Label")).toBeTruthy();
  });

  it("renders with secondary color", () => {
    const { getByText } = renderWithTheme(<Text secondary>Muted text</Text>);
    expect(getByText("Muted text")).toBeTruthy();
  });

  it("renders with align prop", () => {
    const { getByText } = renderWithTheme(<Text align="center">Centered</Text>);
    expect(getByText("Centered")).toBeTruthy();
  });

  describe("numeric stat variants (STORY-002 AC 2.3)", () => {
    const flatten = (style: unknown): Record<string, unknown> => {
      if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>(
          (acc, s) => ({ ...acc, ...flatten(s) }),
          {},
        );
      }
      return (style as Record<string, unknown>) ?? {};
    };

    it.each(["stat-md", "stat-lg", "stat-xl"] as const)(
      "%s renders in the mono family with tabular figures",
      (variant) => {
        const { getByText } = renderWithTheme(
          <Text variant={variant} testID={`stat-${variant}`}>
            00
          </Text>,
        );
        const node = getByText("00");
        const style = flatten(node.props.style);
        // Geist Mono resolves through the $mono family; tabular-nums is applied
        // so updating numbers don't shift horizontally.
        expect(JSON.stringify(node.props)).toContain("tabular-nums");
        expect(style.fontFamily ?? "").toMatch(/Geist Mono|\$mono|mono/i);
      },
    );

    it("renders a slashed-zero sample without throwing", () => {
      const { getByText } = renderWithTheme(
        <Text variant="stat-xl">0 00 000</Text>,
      );
      expect(getByText("0 00 000")).toBeTruthy();
    });
  });
});
