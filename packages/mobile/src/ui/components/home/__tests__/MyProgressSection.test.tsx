import { fireEvent } from "@testing-library/react-native";
import { MyProgressSection } from "@/ui/components/home/MyProgressSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("MyProgressSection", () => {
  const granted = {
    steps: "granted" as const,
    calories: "granted" as const,
    bodyWeight: "granted" as const,
    heartRate: "granted" as const,
  };

  const baseProps = {
    workoutsThisMonth: 9,
    workoutsLastMonth: 12,
    activeEnergy: 312,
    basalEnergy: 0,
    standTime: 0,
    bodyWeight: 78.2,
    bodyWeightUnit: "kg" as const,
    bodyWeightHistory: [] as { date: Date; value: number }[],
    bodyFat: 16.5,
    bodyFatHistory: [] as { date: Date; value: number }[],
    stepsToday: 4812,
    stepsHistory: [] as { date: Date; steps: number }[],
    healthIsAvailable: true,
    healthPermissionStatus: granted,
    latestBodyWeight: null,
    onConnectHealthPress: jest.fn(),
    onViewAllPress: jest.fn(),
  };

  it("renders all six tiles in their 3×2 grid", () => {
    const { getByTestId } = renderWithTheme(
      <MyProgressSection {...baseProps} />,
    );
    expect(getByTestId("my-progress-section")).toBeTruthy();
    expect(getByTestId("tile-workouts-month")).toBeTruthy();
    expect(getByTestId("tile-energy")).toBeTruthy();
    expect(getByTestId("tile-body-weight")).toBeTruthy();
    expect(getByTestId("tile-body-fat")).toBeTruthy();
    expect(getByTestId("steps-tile-granted")).toBeTruthy();
  });

  it("renders the workouts-this-month value + last-month comparison", () => {
    const { getByText } = renderWithTheme(<MyProgressSection {...baseProps} />);
    expect(getByText("9")).toBeTruthy();
    expect(getByText(/-3 vs last month/)).toBeTruthy();
  });

  it("renders body weight with its unit (kg)", () => {
    const { getByText } = renderWithTheme(<MyProgressSection {...baseProps} />);
    expect(getByText("78.2 kg")).toBeTruthy();
  });

  it("renders em-dash body fat when value is null", () => {
    const { getByTestId } = renderWithTheme(
      <MyProgressSection {...baseProps} bodyFat={null} />,
    );
    expect(getByTestId("tile-body-fat")).toBeTruthy();
  });

  it("fires onViewAllPress", () => {
    const onViewAllPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MyProgressSection {...baseProps} onViewAllPress={onViewAllPress} />,
    );
    fireEvent.press(getByTestId("my-progress-view-all"));
    expect(onViewAllPress).toHaveBeenCalled();
  });
});
