import {
  fireEvent,
  renderWithTheme,
  waitFor,
} from "../../../../__tests__/test-utils";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { GoalSheet } from "@/ui/presenters/GoalSheet";
import { useGoalSheet } from "@/state/goal-sheet";

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "athlete@x.com",
    expiresAt: Date.now() + 3_600_000,
  };
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(true),
  };
  return { adapters, api };
}

function renderSheet(adapters: Adapters) {
  return renderWithTheme(
    <AdapterProvider adapters={adapters}>
      <GoalSheet />
    </AdapterProvider>,
  );
}

describe("<GoalSheet>", () => {
  beforeEach(() => useGoalSheet.getState().closeSheet());

  it("create: picks a type, saves, and closes", async () => {
    const { adapters, api } = makeAdapters();
    const onChanged = jest.fn();
    useGoalSheet.getState().openForCreate([], onChanged);

    const { getByTestId } = renderSheet(adapters);

    await waitFor(() => getByTestId("goal-sheet-type-gt-strength"));
    fireEvent.press(getByTestId("goal-sheet-type-gt-strength"));
    fireEvent.changeText(getByTestId("goal-sheet-target-date"), "2026-12-31");
    fireEvent.press(getByTestId("goal-sheet-submit"));

    await waitFor(() => expect(useGoalSheet.getState().open).toBe(false));
    expect(onChanged).toHaveBeenCalled();
    expect(api.goals).toHaveLength(1);
    expect(api.goals[0].goalTypeId).toBe("gt-strength");
    const cached = adapters.storage.getCachedGoals("u-1")!;
    expect(cached[0].goalTypeName).toBe("Build strength");
  });

  it("create: hides types the athlete already owns", async () => {
    const { adapters } = makeAdapters();
    // Own the "strength" type already — only "lose-weight" should remain.
    useGoalSheet.getState().openForCreate(["gt-strength"]);

    const { getByTestId, queryByTestId } = renderSheet(adapters);

    await waitFor(() => getByTestId("goal-sheet-type-gt-lose-weight"));
    expect(queryByTestId("goal-sheet-type-gt-strength")).toBeNull();
  });

  it("create: shows the empty state when every type is taken", async () => {
    const { adapters } = makeAdapters();
    useGoalSheet.getState().openForCreate(["gt-strength", "gt-lose-weight"]);

    const { getByTestId } = renderSheet(adapters);

    await waitFor(() => getByTestId("goal-sheet-types-empty"));
  });

  it("create: surfaces a types-load error with retry", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    useGoalSheet.getState().openForCreate([]);

    const { getByTestId } = renderSheet(adapters);

    await waitFor(() => getByTestId("goal-sheet-types-error"));
    api.shouldFail = false;
    fireEvent.press(getByTestId("goal-sheet-types-retry"));
    await waitFor(() => getByTestId("goal-sheet-type-gt-strength"));
  });

  it("edit: shows the goal title, prefilled date, and saves", async () => {
    const { adapters, api } = makeAdapters();
    api.goals.push({
      id: "g-1",
      userId: "u-1",
      goalTypeId: "gt-strength",
      priority: 1,
      targetDate: "2026-01-01",
      isActive: true,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    adapters.storage.cacheGoals("u-1", [
      {
        id: "g-1",
        goalTypeId: "gt-strength",
        goalTypeName: "Build strength",
        iconName: null,
        category: null,
        targetValue: null,
        currentValue: null,
        unit: null,
        targetDate: "2026-01-01",
        notes: null,
        priority: 1,
        isActive: true,
        assignedByUserId: null,
        assignedByName: null,
        isCoachAssigned: false,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    const onChanged = jest.fn();
    useGoalSheet.getState().openForEdit(
      {
        goalId: "g-1",
        goalTypeName: "Build strength",
        targetDate: "2026-01-01",
      },
      onChanged,
    );

    const { getByTestId, getByText } = renderSheet(adapters);

    expect(getByText("Build strength")).toBeTruthy();
    fireEvent.changeText(getByTestId("goal-sheet-target-date"), "2027-03-03");
    // The submit button gates on the async-hydrated auth session; retry the
    // press until the session lands and the save closes the sheet.
    await waitFor(() => {
      fireEvent.press(getByTestId("goal-sheet-submit"));
      expect(useGoalSheet.getState().open).toBe(false);
    });
    expect(onChanged).toHaveBeenCalled();
    expect(adapters.storage.getCachedGoals("u-1")![0].targetDate).toBe(
      "2027-03-03",
    );
  });
});
