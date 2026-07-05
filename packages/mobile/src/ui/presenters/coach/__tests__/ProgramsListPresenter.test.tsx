import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import type { ApiError } from "@/shared/errors";
import type { ProgramSummary } from "@/domain/models/program";
import {
  ProgramsListPresenter,
  filterPrograms,
  isProgramActive,
  type ProgramsListPresenterProps,
} from "../ProgramsListPresenter";

function makeProgram(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    id: "p-1",
    name: "Strength Foundations",
    description: null,
    durationWeeks: 12,
    daysPerWeek: 4,
    workoutCount: 8,
    activeClientCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PROGRAMS: ProgramSummary[] = [
  makeProgram({
    id: "p-active-1",
    name: "Strength Foundations",
    activeClientCount: 5,
    durationWeeks: 12,
    daysPerWeek: 4,
    description: null,
  }),
  makeProgram({
    id: "p-active-2",
    name: "Hypertrophy 8wk",
    activeClientCount: 1,
    durationWeeks: 8,
    daysPerWeek: 6,
    description: "PPL · Volume focus",
  }),
  makeProgram({
    id: "p-draft-1",
    name: "Lean Bulk Phase 2",
    activeClientCount: 0,
    durationWeeks: null,
    daysPerWeek: 5,
    description: null,
  }),
];

function baseProps(
  overrides: Partial<ProgramsListPresenterProps> = {},
): ProgramsListPresenterProps {
  return {
    programs: PROGRAMS,
    searchQuery: "",
    onSearchChange: jest.fn(),
    segment: "Active",
    onSegmentChange: jest.fn(),
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onCreate: jest.fn(),
    onOpenProgram: jest.fn(),
    ...overrides,
  };
}

describe("isProgramActive", () => {
  it("is true when activeClientCount > 0", () => {
    expect(isProgramActive(makeProgram({ activeClientCount: 1 }))).toBe(true);
  });

  it("is false when activeClientCount is 0", () => {
    expect(isProgramActive(makeProgram({ activeClientCount: 0 }))).toBe(false);
  });
});

describe("filterPrograms", () => {
  it("Active shows only programmes with an active client count", () => {
    const out = filterPrograms(PROGRAMS, "Active", "");
    expect(out.map((p) => p.id).sort()).toEqual(
      ["p-active-1", "p-active-2"].sort(),
    );
  });

  it("Drafts shows only programmes with zero active clients", () => {
    const out = filterPrograms(PROGRAMS, "Drafts", "");
    expect(out.map((p) => p.id)).toEqual(["p-draft-1"]);
  });

  it("search matches by name, case-insensitively", () => {
    const out = filterPrograms(PROGRAMS, "Active", "hypertrophy");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("p-active-2");
  });

  it("combines segment + search", () => {
    expect(filterPrograms(PROGRAMS, "Drafts", "strength")).toHaveLength(0);
  });
});

describe("ProgramsListPresenter", () => {
  it("renders the header eyebrow with active/draft counts derived from the full list", () => {
    const { getByText } = renderWithTheme(
      <ProgramsListPresenter {...baseProps()} />,
    );
    expect(getByText("Programmes")).toBeTruthy();
    expect(getByText("2 ACTIVE · 1 DRAFTS")).toBeTruthy();
  });

  it("renders active rows under the Active segment and hides drafts", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps()} />,
    );
    expect(getByTestId("program-row-p-active-1")).toBeTruthy();
    expect(getByTestId("program-row-p-active-2")).toBeTruthy();
    expect(queryByTestId("program-row-p-draft-1")).toBeNull();
  });

  it("renders draft rows under the Drafts segment", () => {
    const { getByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ segment: "Drafts" })} />,
    );
    expect(getByTestId("program-row-p-draft-1")).toBeTruthy();
  });

  it("shows the description as the subtle line when present, else days/wk", () => {
    const { getByText } = renderWithTheme(
      <ProgramsListPresenter {...baseProps()} />,
    );
    expect(getByText("PPL · Volume focus")).toBeTruthy();
    expect(getByText("4 days/wk")).toBeTruthy();
  });

  it("shows DRAFT/ACTIVE pills and duration/client pills correctly", () => {
    const { getByText, queryByText } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ segment: "Drafts" })} />,
    );
    expect(getByText("DRAFT")).toBeTruthy();
    expect(getByText("ONGOING")).toBeTruthy();
    // Draft programme has 0 active clients — the CLIENT(S) pill is omitted.
    expect(queryByText(/CLIENT/)).toBeNull();
  });

  it("shows the ACTIVE pill and pluralised CLIENTS pill for multi-client rows", () => {
    const { getAllByText, getByText } = renderWithTheme(
      <ProgramsListPresenter {...baseProps()} />,
    );
    expect(getAllByText("ACTIVE")).toHaveLength(2);
    expect(getByText("5 CLIENTS")).toBeTruthy();
    expect(getByText("1 CLIENT")).toBeTruthy();
    expect(getByText("12 WKS")).toBeTruthy();
  });

  it("filters rows by the search query", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ searchQuery: "hypertrophy" })} />,
    );
    expect(getByTestId("program-row-p-active-2")).toBeTruthy();
    expect(queryByTestId("program-row-p-active-1")).toBeNull();
  });

  it("renders the loader only when there's no cached data", () => {
    const { getByTestId } = renderWithTheme(
      <ProgramsListPresenter
        {...baseProps({ isLoading: true, programs: [] })}
      />,
    );
    expect(getByTestId("programs-loader")).toBeTruthy();
  });

  it("does not render the loader when cached data is present, even while refreshing", () => {
    const { queryByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ isLoading: true })} />,
    );
    expect(queryByTestId("programs-loader")).toBeNull();
  });

  it("renders the error state only when there's no cached data", () => {
    const error: ApiError = { kind: "api", code: "server", message: "boom" };
    const { getByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ error, programs: [] })} />,
    );
    expect(getByTestId("programs-error-state")).toBeTruthy();
  });

  it("renders the wholly-empty state when there are no programmes at all", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ programs: [] })} />,
    );
    expect(getByTestId("programs-empty")).toBeTruthy();
    expect(getByText("No programmes yet")).toBeTruthy();
  });

  it("renders the filtered-empty state when search matches nothing", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ searchQuery: "zzzz" })} />,
    );
    expect(getByTestId("programs-empty-filtered")).toBeTruthy();
    expect(getByText("No programmes match those filters.")).toBeTruthy();
  });

  it("fires onCreate from the header + button", () => {
    const onCreate = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ onCreate })} />,
    );
    fireEvent.press(getByTestId("programs-create-btn"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("fires onCreate from the dashed New programme CTA", () => {
    const onCreate = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ onCreate })} />,
    );
    fireEvent.press(getByTestId("programs-new-cta"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("fires onOpenProgram with the row id", () => {
    const onOpenProgram = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramsListPresenter {...baseProps({ onOpenProgram })} />,
    );
    fireEvent.press(getByTestId("program-row-p-active-1"));
    expect(onOpenProgram).toHaveBeenCalledWith("p-active-1");
  });

  it("forwards search + segment changes to the container handlers", () => {
    const onSearchChange = jest.fn();
    const onSegmentChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramsListPresenter
        {...baseProps({ onSearchChange, onSegmentChange })}
      />,
    );
    fireEvent.changeText(getByTestId("programs-search-input"), "cut");
    expect(onSearchChange).toHaveBeenCalledWith("cut");
    fireEvent.press(getByTestId("programs-segmented-option-Drafts"));
    expect(onSegmentChange).toHaveBeenCalledWith("Drafts");
  });
});
