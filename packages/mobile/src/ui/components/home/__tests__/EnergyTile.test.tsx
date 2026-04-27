import { EnergyTile } from "@/ui/components/home/EnergyTile";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("EnergyTile", () => {
  it("renders active + basal + stand rows with rounded values", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <EnergyTile activeEnergy={312.4} basalEnergy={1456.9} standTime={9.6} />,
    );
    expect(getByTestId("tile-energy")).toBeTruthy();
    expect(getByText("312 kcal")).toBeTruthy();
    expect(getByText("1,457 kcal")).toBeTruthy();
    expect(getByText("10h")).toBeTruthy();
  });

  it("shows zeros when every metric is zero", () => {
    const { getAllByText, getByText } = renderWithTheme(
      <EnergyTile activeEnergy={0} basalEnergy={0} standTime={0} />,
    );
    expect(getAllByText("0 kcal").length).toBe(2);
    expect(getByText("0h")).toBeTruthy();
  });
});
