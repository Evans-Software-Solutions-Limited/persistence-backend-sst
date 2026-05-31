import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { PRCard } from "../PRCard";

describe("PRCard", () => {
  it("renders the NEW PR badge, lift name, value + unit", () => {
    const { getByText } = renderWithTheme(
      <PRCard
        exerciseName="Bench Press"
        value="85"
        unit="kg"
        date="2 days ago"
      />,
    );
    expect(getByText("NEW PR")).toBeTruthy();
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("85")).toBeTruthy();
    expect(getByText("kg")).toBeTruthy();
  });

  it("renders a signed delta when supplied", () => {
    const { getByText } = renderWithTheme(
      <PRCard
        exerciseName="Squat"
        value="120"
        unit="kg"
        delta="+2.5"
        date="5 days ago"
      />,
    );
    expect(getByText("+2.5")).toBeTruthy();
  });

  it("omits the delta when not supplied", () => {
    const { queryByText } = renderWithTheme(
      <PRCard exerciseName="Row" value="80" unit="kg" date="1 week ago" />,
    );
    // no delta node — only value/unit render in the value row
    expect(queryByText(/^\+/)).toBeNull();
  });

  it("renders the relative date string", () => {
    const { getByText } = renderWithTheme(
      <PRCard exerciseName="Row" value="80" unit="kg" date="1 week ago" />,
    );
    expect(getByText("1 week ago")).toBeTruthy();
  });

  it("accepts a numeric value", () => {
    const { getByText } = renderWithTheme(
      <PRCard exerciseName="OHP" value={55} unit="kg" date="2w" />,
    );
    expect(getByText("55")).toBeTruthy();
  });

  it("renders skeleton blocks when loading (no content)", () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <PRCard
        exerciseName="Bench Press"
        value="85"
        unit="kg"
        date="2 days ago"
        loading
        testID="pr"
      />,
    );
    expect(getByTestId("pr-skeleton")).toBeTruthy();
    expect(queryByText("Bench Press")).toBeNull();
    expect(queryByText("NEW PR")).toBeNull();
  });

  it("renders a loading card without a testID", () => {
    const { queryByTestId, queryByText } = renderWithTheme(
      <PRCard exerciseName="X" value="1" unit="kg" date="now" loading />,
    );
    expect(queryByText("X")).toBeNull();
    expect(queryByTestId("pr-skeleton")).toBeNull();
  });

  it("exposes a personal-record accessibility label", () => {
    const { getByTestId } = renderWithTheme(
      <PRCard
        exerciseName="Bench Press"
        value="85"
        unit="kg"
        date="2 days ago"
        testID="pr"
      />,
    );
    expect(getByTestId("pr").props.accessibilityLabel).toContain(
      "Personal record: Bench Press",
    );
  });
});
