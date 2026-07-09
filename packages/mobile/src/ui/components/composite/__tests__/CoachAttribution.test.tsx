import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { CoachAttribution } from "../CoachAttribution";

describe("CoachAttribution", () => {
  it("text variant renders the default 'Set by Coach {name}' copy", () => {
    const { getByText } = renderWithTheme(
      <CoachAttribution name="Bradley Evans" testID="attr" />,
    );
    expect(getByText("Bradley Evans")).toBeTruthy();
    // The label + name compose "Set by Coach Bradley Evans".
    expect(getByText(/Set by Coach/)).toBeTruthy();
  });

  it("honours a custom label", () => {
    const { getByText } = renderWithTheme(
      <CoachAttribution name="Bradley Evans" label="Assigned by Coach" />,
    );
    expect(getByText(/Assigned by Coach/)).toBeTruthy();
    expect(getByText("Bradley Evans")).toBeTruthy();
  });

  it("banner variant renders inside a card with the info glyph + name", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <CoachAttribution
        variant="banner"
        name="Coach Bradley"
        testID="banner"
      />,
    );
    expect(getByTestId("banner")).toBeTruthy();
    expect(getByText("Coach Bradley")).toBeTruthy();
    expect(getByText(/Set by Coach/)).toBeTruthy();
  });
});
