import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AddToMealDialog } from "../nutrition/AddToMealDialog";
import { PickPlanDialog } from "../nutrition/NutritionTabContainer";
import { PlanWheel, TargetStrip } from "../nutrition/PlanWheel";
import {
  SendPlanDialog,
  type SendPlanDialogProps,
} from "../nutrition/SendPlanDialog";
import { ShareRecipeDialog } from "../nutrition/ShareRecipeContainer";
import { planVsTarget } from "../lib/mealPlans";
import { ROSTER } from "./helpers";
import { RECIPES } from "./mealPlanFixtures";

afterEach(cleanup);

const sendProps = (
  over: Partial<SendPlanDialogProps> = {},
): SendPlanDialogProps => ({
  mode: "send",
  planName: "Cut",
  versusTarget: null,
  clientName: null,
  clients: ROSTER.data,
  clientId: null,
  note: "",
  noteError: null,
  busy: false,
  offline: false,
  error: null,
  onClient: vi.fn(),
  onNote: vi.fn(),
  onSubmit: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

describe("C5 Send presenter", () => {
  it("before a client is chosen: plain copy and Send off", () => {
    render(<SendPlanDialog {...sendProps()} />);
    expect(screen.getByLabelText("Note")).toBeTruthy();
    expect(screen.getByText(/It goes into your client’s plans/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("offline, busy and errors in both modes", () => {
    const { rerender } = render(
      <SendPlanDialog {...sendProps({ offline: true })} />,
    );
    expect(
      screen.getByText(
        "You’re offline. Sending needs a connection, so Send waits until you’re back.",
      ),
    ).toBeTruthy();
    rerender(
      <SendPlanDialog
        {...sendProps({
          offline: true,
          clientName: "Sam Patel",
          clients: null,
          clientId: "c",
        })}
      />,
    );
    expect(screen.getByText(/so Send to Sam waits/)).toBeTruthy();
    rerender(<SendPlanDialog {...sendProps({ busy: true, clientId: "c" })} />);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
    rerender(
      <SendPlanDialog
        {...sendProps({
          mode: "note",
          offline: true,
          noteError: "Too long",
          error: "Nope",
        })}
      />,
    );
    expect(
      screen.getByText("You’re offline. Changing the note needs a connection."),
    ).toBeTruthy();
    expect(screen.getByText("Too long")).toBeTruthy();
    expect(screen.getByText("Nope")).toBeTruthy();
    rerender(<SendPlanDialog {...sendProps({ mode: "note", busy: true })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
  });
});

describe("share and pick presenters", () => {
  it("share: no recipes yet, offline, busy", () => {
    const onClose = vi.fn();
    render(
      <ShareRecipeDialog
        recipe={null}
        recipes={[]}
        recipeId={null}
        clientName="Sam Patel"
        clients={null}
        clientId={null}
        busy
        offline
        error="Bad"
        onRecipe={vi.fn()}
        onClient={vi.fn()}
        onShare={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("No recipes yet")).toBeTruthy();
    expect(
      screen.getByText("You’re offline. Sharing needs a connection."),
    ).toBeTruthy();
    expect(screen.getByText("Bad")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sharing…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("share from the library: the recipe is known, pick a client", () => {
    const onClient = vi.fn();
    render(
      <ShareRecipeDialog
        recipe={RECIPES[0]!}
        recipes={null}
        recipeId={RECIPES[0]!.id}
        clientName={null}
        clients={ROSTER.data}
        clientId={null}
        busy={false}
        offline={false}
        error={null}
        onRecipe={vi.fn()}
        onClient={onClient}
        onShare={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Your client gets their own copy/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Share with"), {
      target: { value: ROSTER.data[0]!.id },
    });
    expect(onClient).toHaveBeenCalledWith(ROSTER.data[0]!.id);
  });

  it("pick a plan: loading and an empty library", () => {
    const { rerender } = render(
      <MemoryRouter>
        <PickPlanDialog
          clientFirst="Sam"
          plans={null}
          sentPlanIds={new Set()}
          onPick={vi.fn()}
          onBuild={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
    rerender(
      <MemoryRouter>
        <PickPlanDialog
          clientFirst="Sam"
          plans={[]}
          sentPlanIds={new Set()}
          onPick={vi.fn()}
          onBuild={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Your library has no plans yet.")).toBeTruthy();
  });
});

describe("C4 and the wheel presenters", () => {
  const base = {
    planName: "Cut",
    mealName: "Meal 4",
    query: "",
    empty: "Nothing",
    selected: new Set<string>(),
    onTab: vi.fn(),
    onQuery: vi.fn(),
    onToggle: vi.fn(),
    onAdd: vi.fn(),
    onClose: vi.fn(),
  };

  it("loading, offline food search and an error", () => {
    const { rerender } = render(
      <AddToMealDialog
        {...base}
        tab="foods"
        rows={null}
        offline
        error={null}
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      screen.getByText("You’re offline. Food search needs a connection."),
    ).toBeTruthy();
    rerender(
      <AddToMealDialog
        {...base}
        tab="recipes"
        rows={[{ id: "r", name: "Bowl", sub: "Your recipe", kcal: "612" }]}
        selected={new Set(["recipes:r"])}
        offline
        error="Broken"
      />,
    );
    expect(screen.queryByText(/Food search needs a connection/)).toBeNull();
    expect(screen.getByText("Broken")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add 1 item to Meal 4" }),
    ).toBeTruthy();
  });

  it("the wheel's tones and the strip without a target", () => {
    const planned = { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 };
    const target = { dailyKcal: 2500, proteinG: 180, carbsG: 300, fatG: 70 };
    const { rerender } = render(
      <>
        <PlanWheel view={planVsTarget(planned, target)} />
        <TargetStrip
          targetKcal="2,500"
          targetLabel="Target"
          plannedKcal="2,000"
          view={planVsTarget(planned, target)}
        />
      </>,
    );
    expect(screen.getAllByText("500").length).toBe(2);
    const over = planVsTarget({ ...planned, kcal: 3000 }, target);
    rerender(
      <>
        <PlanWheel view={over} />
        <TargetStrip
          targetKcal={null}
          targetLabel="Target"
          plannedKcal="3,000"
          view={planVsTarget(planned, null)}
        />
      </>,
    );
    expect(screen.getByText("+500")).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("No target")).toBeTruthy();
  });
});
