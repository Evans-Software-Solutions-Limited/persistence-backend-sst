import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { PRCard } from "../PRCard";

const ACHIEVED = new Date("2026-05-20T10:00:00Z");

describe("PRCard", () => {
  it("renders exercise name + new value", () => {
    const { getByText } = renderWithTheme(
      <PRCard
        exerciseName="Bench Press"
        newValue="120 KG × 5"
        achievedAt={ACHIEVED}
      />,
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("120 KG × 5")).toBeTruthy();
  });

  it("renders the previous value struck through", () => {
    const { getByText } = renderWithTheme(
      <PRCard
        exerciseName="Squat"
        newValue="140 KG × 3"
        previousValue="130 KG × 3"
        achievedAt={ACHIEVED}
      />,
    );
    const prev = getByText("130 KG × 3");
    const flat = Array.isArray(prev.props.style)
      ? Object.assign({}, ...prev.props.style)
      : prev.props.style;
    expect(flat.textDecorationLine).toBe("line-through");
  });

  it("renders a delta with a ▲ prefix", () => {
    const { getByText } = renderWithTheme(
      <PRCard
        exerciseName="Deadlift"
        newValue="200 KG"
        delta={{ value: 10, unit: "kg" }}
        achievedAt={ACHIEVED}
      />,
    );
    expect(getByText("▲ 10kg")).toBeTruthy();
  });

  it("renders the achieved date (en-GB short)", () => {
    const { getByText } = renderWithTheme(
      <PRCard exerciseName="Row" newValue="80 KG" achievedAt={ACHIEVED} />,
    );
    expect(getByText("20 May")).toBeTruthy();
  });

  it("renders skeleton blocks when loading", () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <PRCard
        exerciseName="Bench Press"
        newValue="120 KG × 5"
        achievedAt={ACHIEVED}
        loading
        testID="pr"
      />,
    );
    expect(getByTestId("pr-skeleton")).toBeTruthy();
    expect(queryByText("Bench Press")).toBeNull();
  });

  it("renders a loading card without a testID", () => {
    const { queryByTestId, queryByText } = renderWithTheme(
      <PRCard exerciseName="X" newValue="1" achievedAt={ACHIEVED} loading />,
    );
    expect(queryByText("X")).toBeNull();
    expect(queryByTestId("pr-skeleton")).toBeNull();
  });

  it("exposes a personal-record accessibility label", () => {
    const { getByTestId } = renderWithTheme(
      <PRCard
        exerciseName="Bench Press"
        newValue="120 KG × 5"
        achievedAt={ACHIEVED}
        testID="pr"
      />,
    );
    expect(getByTestId("pr").props.accessibilityLabel).toContain(
      "Personal record: Bench Press",
    );
  });
});
