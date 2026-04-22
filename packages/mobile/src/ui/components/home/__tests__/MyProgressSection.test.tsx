import { fireEvent } from "@testing-library/react-native";
import { MyProgressSection } from "@/ui/components/home/MyProgressSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("MyProgressSection", () => {
  const baseProps = {
    progress: {
      workoutsThisMonth: 9,
      workoutsLastMonth: 12,
      streak: 4,
      personalRecordsCount: 7,
    },
    latestMeasurement: { weightKg: 78.2, bodyFatPercentage: 16.5 },
    stepsToday: 4812,
    activeCaloriesToday: 312,
    latestBodyWeight: null,
    healthIsAvailable: true,
    healthPermissionStatus: {
      steps: "granted" as const,
      calories: "granted" as const,
      bodyWeight: "granted" as const,
      heartRate: "granted" as const,
    },
    lastHealthReadAt: null,
    onConnectHealthPress: jest.fn(),
    onViewAllPress: jest.fn(),
  };

  it("renders the workouts-this-month tile with count", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <MyProgressSection {...baseProps} />,
    );
    expect(getByTestId("tile-workouts-month")).toBeTruthy();
    expect(getByText("9")).toBeTruthy();
    expect(getByText(/Last month: 12/)).toBeTruthy();
  });

  it("renders the streak tile with days", () => {
    const { getByText } = renderWithTheme(<MyProgressSection {...baseProps} />);
    expect(getByText("4d")).toBeTruthy();
  });

  it("falls back to health-sourced weight when measurement is null", () => {
    const { getByText } = renderWithTheme(
      <MyProgressSection
        {...baseProps}
        latestMeasurement={null}
        latestBodyWeight={{
          value: 75,
          unit: "kg",
          date: "2026-04-20T07:00:00Z",
        }}
      />,
    );
    expect(getByText("75.0 kg")).toBeTruthy();
  });

  it("renders em-dash when no weight is available", () => {
    const { getByTestId } = renderWithTheme(
      <MyProgressSection
        {...baseProps}
        latestMeasurement={null}
        latestBodyWeight={null}
      />,
    );
    expect(getByTestId("tile-body-weight")).toBeTruthy();
  });

  it("renders body fat percentage when present", () => {
    const { getByText } = renderWithTheme(<MyProgressSection {...baseProps} />);
    expect(getByText("16.5%")).toBeTruthy();
  });

  it("renders em-dash when body fat is null", () => {
    const { getByTestId } = renderWithTheme(
      <MyProgressSection
        {...baseProps}
        latestMeasurement={{ weightKg: 80, bodyFatPercentage: null }}
      />,
    );
    expect(getByTestId("tile-body-fat")).toBeTruthy();
  });

  it("renders active energy in kcal", () => {
    const { getByText } = renderWithTheme(<MyProgressSection {...baseProps} />);
    expect(getByText("312 kcal")).toBeTruthy();
  });

  it("fires onViewAllPress", () => {
    const onViewAll = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MyProgressSection {...baseProps} onViewAllPress={onViewAll} />,
    );
    fireEvent.press(getByTestId("my-progress-view-all"));
    expect(onViewAll).toHaveBeenCalled();
  });

  it("renders 'Start today' caption when streak is zero", () => {
    const { getByText } = renderWithTheme(
      <MyProgressSection
        {...baseProps}
        progress={{ ...baseProps.progress, streak: 0 }}
      />,
    );
    expect(getByText("Start today")).toBeTruthy();
  });
});
