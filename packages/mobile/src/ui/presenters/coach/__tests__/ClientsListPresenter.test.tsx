import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import type { ApiError } from "@/shared/errors";
import {
  ClientsListPresenter,
  filterClients,
  needsAttentionCount,
  newPrCount,
  type ClientsListPresenterProps,
} from "../ClientsListPresenter";
import { FIXED_NOW, makeTrainerClients } from "./trainerClients.fixture";

const ROSTER = makeTrainerClients();

function baseProps(
  overrides: Partial<ClientsListPresenterProps> = {},
): ClientsListPresenterProps {
  return {
    clients: ROSTER,
    activeCount: 5,
    searchQuery: "",
    onSearchChange: jest.fn(),
    segment: "Active",
    onSegmentChange: jest.fn(),
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onInvite: jest.fn(),
    onOpenClient: jest.fn(),
    now: FIXED_NOW,
    ...overrides,
  };
}

describe("filterClients", () => {
  it("Active shows only active-status clients", () => {
    const out = filterClients(ROSTER, "Active", "");
    expect(out.every((c) => c.status === "active")).toBe(true);
    expect(out.find((c) => c.id === "c-noah")).toBeUndefined();
  });

  it("All shows active + pending", () => {
    const out = filterClients(ROSTER, "All", "");
    expect(out).toHaveLength(ROSTER.length);
    expect(out.find((c) => c.id === "c-noah")).toBeDefined();
  });

  it("Archive shows nothing in v1", () => {
    expect(filterClients(ROSTER, "Archive", "")).toHaveLength(0);
  });

  it("search matches by name, case-insensitively", () => {
    const out = filterClients(ROSTER, "All", "priya");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c-priya");
  });
});

describe("summary counts", () => {
  it("needsAttention counts at-risk/crisis bands and MISSED flags", () => {
    // Tom (crisis), Marcus (atRisk + 2 MISSED) → 2.
    expect(needsAttentionCount(ROSTER)).toBe(2);
  });

  it("newPr counts clients with a NEW PR flag", () => {
    expect(newPrCount(ROSTER)).toBe(1);
  });
});

describe("ClientsListPresenter", () => {
  it("renders the header, eyebrow, summary chips, and active rows", () => {
    const { getByText, getByTestId, queryByTestId } = renderWithTheme(
      <ClientsListPresenter {...baseProps()} />,
    );
    expect(getByText("Clients")).toBeTruthy();
    expect(getByText("COACHING · 5 ACTIVE")).toBeTruthy();
    expect(getByTestId("clients-summary-attention")).toBeTruthy();
    // Active segment hides the pending client.
    expect(getByTestId("client-row-c-priya")).toBeTruthy();
    expect(queryByTestId("client-row-c-noah")).toBeNull();
  });

  it("shows the pending client under the All segment", () => {
    const { getByTestId } = renderWithTheme(
      <ClientsListPresenter {...baseProps({ segment: "All" })} />,
    );
    expect(getByTestId("client-row-c-noah")).toBeTruthy();
  });

  it("filters rows by the search query", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ClientsListPresenter
        {...baseProps({ segment: "All", searchQuery: "marcus" })}
      />,
    );
    expect(getByTestId("client-row-c-marcus")).toBeTruthy();
    expect(queryByTestId("client-row-c-priya")).toBeNull();
  });

  it("renders the loader only when there's no cached data", () => {
    const { getByTestId } = renderWithTheme(
      <ClientsListPresenter {...baseProps({ isLoading: true, clients: [] })} />,
    );
    expect(getByTestId("clients-loader")).toBeTruthy();
  });

  it("renders the error state only when there's no cached data", () => {
    const error: ApiError = {
      kind: "api",
      code: "server",
      message: "boom",
    };
    const { getByTestId } = renderWithTheme(
      <ClientsListPresenter {...baseProps({ error, clients: [] })} />,
    );
    expect(getByTestId("clients-error-state")).toBeTruthy();
  });

  it("renders the invite empty state when the roster is wholly empty", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ClientsListPresenter {...baseProps({ clients: [], activeCount: 0 })} />,
    );
    expect(getByTestId("clients-empty")).toBeTruthy();
    expect(getByText("No clients yet")).toBeTruthy();
  });

  it("renders the filtered-empty state for the Archive segment", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ClientsListPresenter {...baseProps({ segment: "Archive" })} />,
    );
    expect(getByTestId("clients-empty-filtered")).toBeTruthy();
    expect(getByText("Archived clients will show up here.")).toBeTruthy();
  });

  it("renders the filtered-empty state when search matches nothing", () => {
    const { getByText } = renderWithTheme(
      <ClientsListPresenter
        {...baseProps({ segment: "All", searchQuery: "zzzz" })}
      />,
    );
    expect(getByText("No clients match those filters.")).toBeTruthy();
  });

  it("toggles the adherence legend open and closed", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ClientsListPresenter {...baseProps()} />,
    );
    expect(queryByTestId("clients-legend")).toBeNull();
    fireEvent.press(getByTestId("clients-legend-toggle"));
    expect(getByTestId("clients-legend")).toBeTruthy();
    // The legend's own close button collapses it.
    fireEvent.press(getByTestId("clients-legend-close"));
    expect(queryByTestId("clients-legend")).toBeNull();
  });

  it("fires onInvite from the header +", () => {
    const onInvite = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ClientsListPresenter {...baseProps({ onInvite })} />,
    );
    fireEvent.press(getByTestId("clients-invite-btn"));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it("fires onOpenClient with the row id", () => {
    const onOpenClient = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ClientsListPresenter {...baseProps({ onOpenClient })} />,
    );
    fireEvent.press(getByTestId("client-row-c-priya"));
    expect(onOpenClient).toHaveBeenCalledWith("c-priya");
  });

  it("forwards search + segment changes to the container handlers", () => {
    const onSearchChange = jest.fn();
    const onSegmentChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ClientsListPresenter
        {...baseProps({ onSearchChange, onSegmentChange })}
      />,
    );
    fireEvent.changeText(getByTestId("clients-search-input"), "ai");
    expect(onSearchChange).toHaveBeenCalledWith("ai");
    fireEvent.press(getByTestId("clients-segmented-option-All"));
    expect(onSegmentChange).toHaveBeenCalledWith("All");
  });
});
