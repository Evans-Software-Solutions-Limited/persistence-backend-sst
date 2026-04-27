import { BodyWeightTile } from "@/ui/components/home/BodyWeightTile";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("BodyWeightTile", () => {
  it("renders em-dash when currentValue is null", () => {
    const { getByText } = renderWithTheme(
      <BodyWeightTile currentValue={null} history={[]} />,
    );
    expect(getByText("—")).toBeTruthy();
  });

  it("renders value with kg unit by default", () => {
    const { getByText } = renderWithTheme(
      <BodyWeightTile currentValue={78.2} history={[]} />,
    );
    expect(getByText("78.2 kg")).toBeTruthy();
  });

  it("renders value with lbs unit when explicitly lbs", () => {
    const { getByText } = renderWithTheme(
      <BodyWeightTile currentValue={172.4} unit="lbs" history={[]} />,
    );
    expect(getByText("172.4 lbs")).toBeTruthy();
  });

  it("renders the SimpleLineGraph when history has points", () => {
    const history = [
      { date: new Date("2026-04-17"), value: 77.8 },
      { date: new Date("2026-04-18"), value: 78.0 },
      { date: new Date("2026-04-19"), value: 78.1 },
    ];
    const { toJSON } = renderWithTheme(
      <BodyWeightTile currentValue={78.2} history={history} />,
    );
    // Graph-branch fires an SVG path — presence proves the branch
    // executed (vs the empty-history fallback which renders no SVG).
    expect(JSON.stringify(toJSON())).toContain('"d":"M ');
  });

  it("skips the graph when history is empty", () => {
    const { toJSON } = renderWithTheme(
      <BodyWeightTile currentValue={78.2} history={[]} />,
    );
    expect(JSON.stringify(toJSON())).not.toContain('"d":"M ');
  });

  it("renders a MOCK chip when isMock=true", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <BodyWeightTile currentValue={74.5} history={[]} isMock />,
    );
    expect(getByTestId("body-weight-tile-mock-chip")).toBeTruthy();
    expect(getByText("MOCK")).toBeTruthy();
  });

  it("omits the MOCK chip by default", () => {
    const { queryByTestId } = renderWithTheme(
      <BodyWeightTile currentValue={74.5} history={[]} />,
    );
    expect(queryByTestId("body-weight-tile-mock-chip")).toBeNull();
  });
});
