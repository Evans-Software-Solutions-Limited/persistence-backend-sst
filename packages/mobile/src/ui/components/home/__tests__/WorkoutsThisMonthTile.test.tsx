import { WorkoutsThisMonthTile } from "@/ui/components/home/WorkoutsThisMonthTile";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("WorkoutsThisMonthTile", () => {
  it("renders the current count + positive delta vs last month", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <WorkoutsThisMonthTile current={14} lastMonth={10} />,
    );
    expect(getByTestId("tile-workouts-month")).toBeTruthy();
    expect(getByText("14")).toBeTruthy();
    expect(getByText("+4 vs last month")).toBeTruthy();
  });

  it("renders negative delta (no plus sign) when below last month", () => {
    const { getByText } = renderWithTheme(
      <WorkoutsThisMonthTile current={6} lastMonth={10} />,
    );
    expect(getByText("-4 vs last month")).toBeTruthy();
  });

  it("omits the comparison line when lastMonth is 0", () => {
    const { queryByText, getByText } = renderWithTheme(
      <WorkoutsThisMonthTile current={5} lastMonth={0} />,
    );
    expect(getByText("5")).toBeTruthy();
    expect(queryByText(/vs last month/)).toBeNull();
  });
});
