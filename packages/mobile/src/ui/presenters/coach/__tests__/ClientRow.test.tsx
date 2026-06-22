import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import type { TrainerClient } from "@/domain/models/trainerClient";
import { ClientRow, buildClientSubtitle } from "../ClientRow";
import { BAND_DISPLAY } from "../clientBand";
import { FIXED_NOW, makeTrainerClients } from "./trainerClients.fixture";

const ROSTER = makeTrainerClients();
const byId = (id: string): TrainerClient =>
  ROSTER.find((c) => c.id === id) as TrainerClient;

describe("buildClientSubtitle", () => {
  it("renders just the relative last-seen when programLabel is null (v1)", () => {
    expect(buildClientSubtitle(byId("c-priya"), FIXED_NOW)).toBe("15m ago");
  });

  it("falls back to a no-sessions label when lastSeenAt is null", () => {
    expect(buildClientSubtitle(byId("c-noah"), FIXED_NOW)).toBe(
      "No sessions yet",
    );
  });

  it("prefixes the programLabel segment when present (forward-compat)", () => {
    const withProgram: TrainerClient = {
      ...byId("c-priya"),
      programLabel: "Strength · Wk 4 / 12",
    };
    expect(buildClientSubtitle(withProgram, FIXED_NOW)).toBe(
      "Strength · Wk 4 / 12 · 15m ago",
    );
  });
});

describe("BAND_DISPLAY", () => {
  it("maps every band to the prototype tone + label", () => {
    expect(BAND_DISPLAY.stellar).toEqual({ tone: "gold", label: "Stellar" });
    expect(BAND_DISPLAY.strong).toEqual({ tone: "success", label: "Strong" });
    expect(BAND_DISPLAY.wobbling).toEqual({ tone: "gold", label: "Wobbling" });
    expect(BAND_DISPLAY.atRisk).toEqual({ tone: "ember", label: "At risk" });
    expect(BAND_DISPLAY.crisis).toEqual({ tone: "error", label: "Crisis" });
  });
});

describe("ClientRow", () => {
  it("renders name, flag pill, subtitle, and the adherence caption", () => {
    const { getByText } = renderWithTheme(
      <ClientRow
        client={byId("c-priya")}
        onPress={jest.fn()}
        now={FIXED_NOW}
      />,
    );
    expect(getByText("Priya Shah")).toBeTruthy();
    expect(getByText("NEW PR")).toBeTruthy();
    expect(getByText("15m ago")).toBeTruthy();
    expect(getByText("100% · Stellar")).toBeTruthy();
  });

  it("renders the band label for an at-risk client", () => {
    const { getByText } = renderWithTheme(
      <ClientRow
        client={byId("c-marcus")}
        onPress={jest.fn()}
        now={FIXED_NOW}
      />,
    );
    expect(getByText("64% · At risk")).toBeTruthy();
    expect(getByText("2 MISSED")).toBeTruthy();
  });

  it("omits the adherence bar + caption when adherence is null", () => {
    const { queryByText } = renderWithTheme(
      <ClientRow client={byId("c-noah")} onPress={jest.fn()} now={FIXED_NOW} />,
    );
    expect(queryByText(/%/)).toBeNull();
    expect(queryByText("No sessions yet")).toBeTruthy();
  });

  it("renders as the last row with default props (no divider, default clock)", () => {
    const { getByText } = renderWithTheme(
      <ClientRow client={byId("c-aisha")} onPress={jest.fn()} isLast />,
    );
    // No `now` / `testID` passed → exercises the default-parameter branches.
    expect(getByText("Aisha Williams")).toBeTruthy();
    expect(getByText("88% · Strong")).toBeTruthy();
  });

  it("fires onPress with the client id", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ClientRow
        client={byId("c-priya")}
        onPress={onPress}
        now={FIXED_NOW}
        testID="row"
      />,
    );
    fireEvent.press(getByTestId("row"));
    expect(onPress).toHaveBeenCalledWith("c-priya");
  });
});
