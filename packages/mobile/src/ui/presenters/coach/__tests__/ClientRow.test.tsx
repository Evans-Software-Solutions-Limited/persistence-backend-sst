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

  // QA-15 (device-QA batch, BRIEF-7): onboarding may not have set a name/
  // initials yet — the row must fall back rather than render blank.
  it("falls back to 'New client' + '?' initials when name/initials are empty", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ClientRow
        client={{ ...byId("c-noah"), name: "", initials: "" }}
        onPress={jest.fn()}
        now={FIXED_NOW}
        testID="row"
      />,
    );
    expect(getByText("New client")).toBeTruthy();
    expect(getByTestId("row").props.accessibilityLabel).toBe("New client");
    expect(getByText("?")).toBeTruthy();
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

  describe("Coach Mode Phase 8 (invite/QR) — client-initiated pending accept/decline", () => {
    function pendingClientInitiated(): TrainerClient {
      return {
        ...byId("c-noah"),
        relationshipId: "rel-noah",
        initiatedBy: "client",
      };
    }

    it("shows the Awaiting-your-OK pill + Accept/Decline for a client-initiated pending row", () => {
      const { getByText, getByTestId } = renderWithTheme(
        <ClientRow
          client={pendingClientInitiated()}
          onPress={jest.fn()}
          onAccept={jest.fn()}
          onDecline={jest.fn()}
          testID="row"
        />,
      );
      expect(getByText("Awaiting your OK")).toBeTruthy();
      expect(getByTestId("row-accept")).toBeTruthy();
      expect(getByTestId("row-decline")).toBeTruthy();
    });

    it("omits the affordance for a TRAINER-initiated pending row (email invite / unredeemed code)", () => {
      const { queryByText, queryByTestId } = renderWithTheme(
        <ClientRow
          client={{ ...byId("c-noah"), initiatedBy: "trainer" }}
          onPress={jest.fn()}
          onAccept={jest.fn()}
          onDecline={jest.fn()}
          testID="row"
        />,
      );
      expect(queryByText("Awaiting your OK")).toBeNull();
      expect(queryByTestId("row-accept")).toBeNull();
    });

    it("omits the affordance when onAccept/onDecline aren't wired, even for a client-initiated pending row", () => {
      const { queryByTestId } = renderWithTheme(
        <ClientRow
          client={pendingClientInitiated()}
          onPress={jest.fn()}
          testID="row"
        />,
      );
      expect(queryByTestId("row-accept")).toBeNull();
    });

    it("omits the affordance when relationshipId is missing (backend hasn't attached it yet)", () => {
      const { queryByTestId } = renderWithTheme(
        <ClientRow
          client={{
            ...byId("c-noah"),
            initiatedBy: "client",
            relationshipId: null,
          }}
          onPress={jest.fn()}
          onAccept={jest.fn()}
          onDecline={jest.fn()}
          testID="row"
        />,
      );
      expect(queryByTestId("row-accept")).toBeNull();
    });

    it("fires onAccept/onDecline with the relationshipId, not the client id", () => {
      const onAccept = jest.fn();
      const onDecline = jest.fn();
      const { getByTestId } = renderWithTheme(
        <ClientRow
          client={pendingClientInitiated()}
          onPress={jest.fn()}
          onAccept={onAccept}
          onDecline={onDecline}
          testID="row"
        />,
      );
      fireEvent.press(getByTestId("row-accept"));
      expect(onAccept).toHaveBeenCalledWith("rel-noah");
      fireEvent.press(getByTestId("row-decline"));
      expect(onDecline).toHaveBeenCalledWith("rel-noah");
    });

    it("disables both buttons while busy", () => {
      const { getByTestId } = renderWithTheme(
        <ClientRow
          client={pendingClientInitiated()}
          onPress={jest.fn()}
          onAccept={jest.fn()}
          onDecline={jest.fn()}
          busy
          testID="row"
        />,
      );
      expect(getByTestId("row-accept").props.accessibilityState?.disabled).toBe(
        true,
      );
      expect(
        getByTestId("row-decline").props.accessibilityState?.disabled,
      ).toBe(true);
    });
  });
});
