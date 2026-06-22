import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { ClientOverviewDonutPresenter } from "../ClientOverviewDonutPresenter";

describe("ClientOverviewDonutPresenter", () => {
  it("renders the CLIENT HEALTH legend with each band label + count", () => {
    const { getByText } = renderWithTheme(
      <ClientOverviewDonutPresenter
        breakdown={[
          { band: "strong", count: 4 },
          { band: "wobbling", count: 2 },
          { band: "atRisk", count: 2 },
        ]}
      />,
    );
    expect(getByText("Client health")).toBeTruthy();
    expect(getByText("Strong (85%+)")).toBeTruthy();
    expect(getByText("Wobbling (65-84%)")).toBeTruthy();
    expect(getByText("At risk (<65%)")).toBeTruthy();
    // donut total = sum of counts
    expect(getByText("8")).toBeTruthy();
  });

  it("defaults missing bands to 0 and renders a zero total", () => {
    const { getByText, getAllByText } = renderWithTheme(
      <ClientOverviewDonutPresenter breakdown={[]} />,
    );
    // 0 renders in the donut centre + each of the 3 legend counts.
    expect(getAllByText("0").length).toBeGreaterThanOrEqual(4);
    // all three legend rows still render
    expect(getByText("Strong (85%+)")).toBeTruthy();
  });
});
