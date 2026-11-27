import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { reorderableTestApi } from "../../../../../__tests__/reorderable-test-api";
import { Text } from "react-native";

import { AddClientWhoContainer } from "../AddClientWhoContainer";
import {
  SetupChecklistContainer,
  COPY_OFFLINE,
} from "../SetupChecklistContainer";
import { SetupSectionContainer } from "../SetupSectionContainer";
import { ClientPreviewContainer } from "../ClientPreviewContainer";
import { resetSyncedProfileIdsForTest } from "@/application/commands/coachClientProfiles.command";
import {
  COACH,
  FULL_SETUP,
  profile,
  programmeDetail,
  setupClients,
} from "./kit";

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    const { Text: T } = jest.requireActual("react-native");
    return <T testID="redirect">{href}</T>;
  },
}));
jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

beforeEach(() => {
  mockParams = {};
  resetSyncedProfileIdsForTest();
  Object.values(mockRouter).forEach((f) => f.mockClear());
});

const queued = (h: ReturnType<typeof setupClients>) =>
  h.storage.getUncompletedMutations();

describe("C11f Who", () => {
  it("needs a first name, then makes the profile offline and moves to Set up", async () => {
    const h = setupClients({ online: false });
    h.server.offline = true;
    const view = h.render(<AddClientWhoContainer />);
    expect(view.getByText("Add a client")).toBeTruthy();
    fireEvent.press(view.getByTestId("who-next"));
    await waitFor(() =>
      expect(view.getByTestId("who-first-error")).toBeTruthy(),
    );
    expect(view.getByText("Add a first name.")).toBeTruthy();

    fireEvent.changeText(view.getByTestId("who-first"), "Lena");
    fireEvent.changeText(view.getByTestId("who-last"), "Ortiz");
    fireEvent.changeText(view.getByTestId("who-contact"), "lena@");
    fireEvent.press(view.getByTestId("who-next"));
    await waitFor(() =>
      expect(view.getByTestId("who-contact-error")).toBeTruthy(),
    );

    fireEvent.changeText(view.getByTestId("who-contact"), "lena@example.com");
    fireEvent.changeText(view.getByTestId("who-goal"), "First pull-up");
    fireEvent.press(view.getByTestId("who-next"));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [created] = h.storage.getCachedCoachClientProfiles(COACH);
    expect(created).toMatchObject({
      displayName: "Lena Ortiz",
      contactEmail: "lena@example.com",
      goal: "First pull-up",
      status: "invited",
    });
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/setup",
      params: { profileId: created!.id, flow: "add" },
    });
    expect(queued(h).map((e) => e.method)).toEqual(["POST"]);
  });

  it("edits an invited client's details: only the changed field, then back", async () => {
    const h = setupClients({ online: false });
    h.server.offline = true;
    h.storage.cacheCoachClientProfile(
      COACH,
      profile("p-lena", { conflictAt: "t" }),
    );
    mockParams = { profileId: "p-lena", flow: "edit" };
    const view = h.render(<AddClientWhoContainer />);
    expect(view.getByText("Lena Ortiz")).toBeTruthy();
    expect(view.getByTestId("who-first").props.value).toBe("Lena");
    expect(view.getByTestId("who-conflict")).toBeTruthy();
    fireEvent.press(view.getByTestId("who-conflict-dismiss"));
    await waitFor(() => expect(view.queryByTestId("who-conflict")).toBeNull());

    fireEvent.changeText(view.getByTestId("who-notes"), "Left knee");
    fireEvent.press(view.getByTestId("who-next"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(JSON.parse(queued(h)[0]!.payload)).toEqual({
      privateNotes: "Left knee",
      expectedRevision: 3,
    });
  });

  it("an edit to a field another device changed keeps the loaded revision", async () => {
    const h = setupClients({ online: false });
    h.server.offline = true;
    h.storage.cacheCoachClientProfile(COACH, profile("p-lena"));
    mockParams = { profileId: "p-lena", flow: "edit" };
    const view = h.render(<AddClientWhoContainer />);
    act(() => {
      h.storage.cacheCoachClientProfile(
        COACH,
        profile("p-lena", { revision: 8, goal: "Changed on the web" }),
      );
    });
    fireEvent.changeText(view.getByTestId("who-goal"), "Mine");
    fireEvent.press(view.getByTestId("who-next"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(JSON.parse(queued(h)[0]!.payload)).toEqual({
      goal: "Mine",
      expectedRevision: 3,
    });
  });

  it("in the add flow, Next on an existing profile goes back to Set up", async () => {
    const h = setupClients({ online: false });
    h.storage.cacheCoachClientProfile(COACH, profile());
    mockParams = { profileId: "p-lena", flow: "add" };
    const view = h.render(<AddClientWhoContainer />);
    expect(view.getByText("Add a client")).toBeTruthy();
    fireEvent.press(view.getByTestId("who-next"));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: "/(app)/coach-clients/[profileId]/setup",
        params: { profileId: "p-lena", flow: "add" },
      }),
    );
    fireEvent.press(view.getByTestId("who-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe("C11g Set up", () => {
  it("lists every section with the canvas summaries and routes each control", async () => {
    const h = setupClients({ online: false });
    h.storage.cacheCoachClientProfile(
      COACH,
      profile("p-lena", { setup: FULL_SETUP }),
    );
    mockParams = { profileId: "p-lena", flow: "add" };
    const view = h.render(<SetupChecklistContainer />);
    expect(view.getByText("Set up Lena")).toBeTruthy();
    expect(view.getByTestId("setup-count").props.children).toBe(
      "6 of 7 set up",
    );
    expect(view.getByText("2 forms · sent when Lena joins")).toBeTruthy();
    expect(view.getByText("Weekly · Sun 09:00 · 2 reminders")).toBeTruthy();
    expect(view.getByText("Lean bulk · Upper / Lower")).toBeTruthy();
    expect(view.getByText("2,100 kcal · 150 g protein")).toBeTruthy();
    expect(view.getByText("Not added")).toBeTruthy();
    expect(view.getByText("+ Add")).toBeTruthy();
    expect(view.getByText("2 resources")).toBeTruthy();
    expect(view.getByText("“Hi Lena, excited to start…”")).toBeTruthy();

    fireEvent.press(view.getByTestId("setup-row-meal_plan"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/section",
      params: { profileId: "p-lena", section: "meal_plan" },
    });
    fireEvent.press(view.getByTestId("setup-preview"));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/preview",
      params: { profileId: "p-lena" },
    });
    const invite = {
      pathname: "/(app)/coach-clients/[profileId]/invite",
      params: { profileId: "p-lena" },
    };
    fireEvent.press(view.getByTestId("setup-next"));
    expect(mockRouter.replace).toHaveBeenLastCalledWith(invite);
    fireEvent.press(view.getByTestId("setup-skip"));
    expect(mockRouter.replace).toHaveBeenCalledTimes(2);
    fireEvent.press(view.getByTestId("setup-back"));
    expect(mockRouter.replace).toHaveBeenLastCalledWith({
      pathname: "/(app)/coach-clients/[profileId]/who",
      params: { profileId: "p-lena", flow: "add" },
    });
  });

  it("copies a set-up from an active client (online), and says when offline", async () => {
    const h = setupClients();
    h.storage.cacheCoachClientProfile(COACH, profile());
    h.storage.cacheTrainerClients(COACH, [
      { id: "c-sam", name: "Sam Patel", status: "active" } as never,
      { id: "c-new", name: "New", status: "pending" } as never,
    ]);
    h.api.trainerClients = [
      { id: "c-sam", name: "Sam Patel", status: "active" } as never,
    ];
    h.api.clientProfiles["p-lena"] = profile("p-lena", {
      revision: 7,
      setup: { resource: [{ refId: "r-1", config: {}, sortOrder: 0 }] },
    });
    mockParams = { profileId: "p-lena", flow: "edit" };
    const view = h.render(<SetupChecklistContainer />);
    expect(view.queryByTestId("setup-next")).toBeNull();
    fireEvent.press(view.getByTestId("setup-copy"));
    await waitFor(() =>
      expect(view.getByTestId("setup-copy-c-sam")).toBeTruthy(),
    );
    expect(view.queryByTestId("setup-copy-c-new")).toBeNull();
    fireEvent.press(view.getByTestId("setup-copy-c-sam"));
    await waitFor(() =>
      expect(
        h.storage.getCachedCoachClientProfile(COACH, "p-lena")?.revision,
      ).toBe(7),
    );
    expect(h.api.coachClientCalls).toContain("copy:p-lena:c-sam");
    expect(view.getByText("1 resource")).toBeTruthy();

    // A refusal is shown on the list.
    await waitFor(() =>
      expect(
        view.getByTestId("setup-copy-c-sam").props.accessibilityState.disabled,
      ).toBe(false),
    );
    h.api.coachClientFailures.copy = {
      kind: "api",
      code: "unknown",
      status: 403,
      message: "Not yours",
      serverCode: "not_your_client",
    };
    fireEvent.press(view.getByTestId("setup-copy-c-sam"));
    await waitFor(() =>
      expect(view.getByText("Something went wrong. Try again.")).toBeTruthy(),
    );

    await waitFor(() =>
      expect(
        view.getByTestId("setup-copy-c-sam").props.accessibilityState.disabled,
      ).toBe(false),
    );
    h.netInfo.setConnected(false);
    fireEvent.press(view.getByTestId("setup-copy-c-sam"));
    await waitFor(() => expect(view.getByText(COPY_OFFLINE)).toBeTruthy());
    fireEvent.press(view.getByTestId("setup-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("shows a missing client, and an accepted one becomes their client page", async () => {
    const h = setupClients({ online: false });
    mockParams = { profileId: "p-x" };
    const missing = h.render(<SetupChecklistContainer />);
    expect(
      await missing.findByText("We couldn't find this client."),
    ).toBeTruthy();
    missing.unmount();
    h.storage.cacheCoachClientProfile(
      COACH,
      profile("p-x", { status: "active", clientId: "c-lena" }),
    );
    const accepted = h.render(<SetupChecklistContainer />);
    expect(accepted.getByTestId("redirect").props.children).toBe(
      "/(app)/clients/c-lena",
    );
  });
});

describe("C11l–r section pages", () => {
  function open(
    section: string,
    setup = FULL_SETUP,
    opts: { online?: boolean } = { online: false },
    before?: (h: ReturnType<typeof setupClients>) => void,
  ) {
    const h = setupClients(opts);
    before?.(h);
    h.server.offline = !(opts.online ?? false);
    h.storage.cacheCoachClientProfile(COACH, profile("p-lena", { setup }));
    mockParams = { profileId: "p-lena", section };
    return { h, view: h.render(<SetupSectionContainer />) };
  }
  const sent = (h: ReturnType<typeof setupClients>) =>
    queued(h).map(
      (e) =>
        JSON.parse(e.payload) as {
          items: { refId: string | null; config: Record<string, unknown> }[];
        },
    );

  it("starter forms: show questions, remove, add from the Library; Back saves", async () => {
    const { h, view } = open("starter_form");
    expect(view.getByText("Starter forms")).toBeTruthy();
    expect(
      view.getByText(
        "Your usual starter forms, sent together when Lena accepts. Drag to reorder.",
      ),
    ).toBeTruthy();
    expect(view.getByText("2 questions · about 1 min")).toBeTruthy();
    fireEvent.press(view.getByTestId("starter-questions-f-join"));
    expect(view.getByText("What do you want from coaching?")).toBeTruthy();
    expect(view.getByText("Long text")).toBeTruthy();
    fireEvent.press(view.getByTestId("starter-questions-f-join"));
    expect(view.queryByText("What do you want from coaching?")).toBeNull();

    fireEvent.press(view.getByTestId("starter-remove-f-life"));
    fireEvent.press(view.getByTestId("starter-picker"));
    fireEvent.press(view.getByTestId("starter-picker-add-f-week"));
    expect(view.getByText("Weekly check-in")).toBeTruthy();
    fireEvent.press(view.getByTestId("starter-reorder-open"));
    expect(view.getByTestId("starter-reorder")).toBeTruthy();
    // Drag Weekly check-in to the top, then move it back down with the
    // accessibility action.
    act(() => {
      reorderableTestApi.dragStart("f-week");
      reorderableTestApi.drop("f-week", 0, { "f-week": 0, "f-join": 1 });
    });
    fireEvent(view.getByTestId("reorder-1"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    fireEvent.press(view.getByTestId("starter-reorder-done"));

    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(sent(h)[0]!.items.map((i) => i.refId)).toEqual(["f-join", "f-week"]);
    expect(view.getByTestId("saves-hint")).toBeTruthy();
  });

  it("keeps the revision it opened on when another device changed the section", async () => {
    const { h, view } = open("starter_form");
    // Another device's copy arrives while the page is open.
    act(() => {
      h.storage.cacheCoachClientProfile(
        COACH,
        profile("p-lena", {
          revision: 5,
          setup: {
            ...FULL_SETUP,
            starter_form: [{ refId: "f-life", config: {}, sortOrder: 0 }],
          },
        }),
      );
    });
    fireEvent.press(view.getByTestId("starter-remove-f-life"));
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(JSON.parse(queued(h)[0]!.payload).expectedRevision).toBe(3);
  });

  it("uses the phone's revision when only other sections moved on", async () => {
    const { h, view } = open("starter_form");
    act(() => {
      h.storage.cacheCoachClientProfile(
        COACH,
        profile("p-lena", { revision: 6, setup: FULL_SETUP }),
      );
    });
    fireEvent.press(view.getByTestId("starter-remove-f-life"));
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(JSON.parse(queued(h)[0]!.payload).expectedRevision).toBe(6);
  });

  it("Cancel drops the page's changes", async () => {
    const { h, view } = open("starter_form");
    fireEvent.press(view.getByTestId("starter-remove-f-life"));
    fireEvent.press(view.getByTestId("section-cancel"));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(queued(h)).toHaveLength(0);
  });

  it("Back with nothing changed saves nothing", async () => {
    const { h, view } = open("resource");
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(queued(h)).toHaveLength(0);
  });

  it("check-ins: the rule's fields become this client's override", async () => {
    const { h, view } = open("repeating_form");
    expect(
      view.getByText(
        "For Lena only. Starts the first Sunday after Lena accepts.",
      ),
    ).toBeTruthy();
    expect(
      view.getByText("Set on the send rule in your Library."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("checkin-questions-s-week"));
    expect(view.getByText("Filled for them")).toBeTruthy();
    fireEvent.press(view.getByTestId("checkin-rule-s-week-day-6"));
    fireEvent.press(view.getByTestId("checkin-picker"));
    // Only "chosen clients" rules can be added; all-clients rules reach everyone.
    expect(view.queryByTestId("checkin-picker-add-s-all")).toBeNull();
    fireEvent.press(view.getByTestId("checkin-picker-add-s-daily"));
    fireEvent.press(view.getByTestId("checkin-remove-s-daily"));
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(sent(h)[0]!.items).toEqual([
      { refId: "s-week", config: { override: { weekday: 6 } }, sortOrder: 0 },
    ]);
  });

  it("programme: workouts in order with Next; Change and Remove", async () => {
    const { view } = open("programme", FULL_SETUP, { online: true }, (h) => {
      h.api.programDetail = programmeDetail("pr-1");
    });
    await waitFor(() =>
      expect(view.getByText("Week 1, in order")).toBeTruthy(),
    );
    expect(view.getByText("Next")).toBeTruthy();
    expect(view.getByText("about 55 min")).toBeTruthy();
    expect(
      view.getByText(
        "For Lena only. Lena sees Upper A as Next; no start date.",
      ),
    ).toBeTruthy();
    expect(
      view.getByText("12 weeks · 4 workouts a week · 48 workouts"),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("programme-change-pr-1"));
    fireEvent.press(view.getByTestId("programme-picker"));
    fireEvent.press(view.getByTestId("programme-picker-add-pr-2"));
    expect(view.getByText("Strength base")).toBeTruthy();
    fireEvent.press(view.getByTestId("programme-remove-pr-2"));
    expect(view.getByText("Add a programme from your Library")).toBeTruthy();
    fireEvent.press(view.getByTestId("programme-picker-add-pr-1"));
    expect(view.getByText("Add another programme")).toBeTruthy();
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it("targets: big numbers, edit them, invalid stays; client sets their own clears", async () => {
    const { h, view } = open("nutrition_target");
    expect(view.getByTestId("targets-kcal-value").props.children).toBe("2,100");
    expect(
      view.getByText("Lena's meal plans and Fuel build toward these."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("targets-edit"));
    fireEvent.changeText(view.getByTestId("targets-proteinG"), "");
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(view.getByTestId("section-error")).toBeTruthy());
    expect(mockRouter.back).not.toHaveBeenCalled();
    fireEvent.changeText(view.getByTestId("targets-proteinG"), "160");
    fireEvent.changeText(view.getByTestId("targets-kcal"), "2200");
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(sent(h)[0]!.items[0]!.config).toEqual({
      dailyKcal: 2200,
      proteinG: 160,
      carbsG: 230,
      fatG: 65,
    });
  });

  it("targets: switching who sets them", async () => {
    const { h, view } = open("nutrition_target", {});
    expect(view.queryByTestId("targets-kcal")).toBeNull();
    fireEvent.press(view.getByTestId("targets-who-coach"));
    expect(view.getByTestId("targets-kcal")).toBeTruthy();
    fireEvent.press(view.getByTestId("targets-who-client"));
    expect(view.queryByTestId("targets-kcal")).toBeNull();
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(queued(h)).toHaveLength(0);
  });

  it("meal plan: lists the coach's plans with Add; offline says it needs a connection", async () => {
    const online = open("meal_plan", {}, { online: true });
    online.h.api.setupMealPlans = [
      {
        id: "pl-1",
        name: "Training day meals",
        totals: { kcal: 2450, proteinG: 0, carbsG: 0, fatG: 0 },
        meals: [{ id: "m", name: "M" }],
      },
    ];
    expect(
      online.view.getByText(
        "No meal plan added. Pick one from your Library, or skip this.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(online.view.getByTestId("plan-picker-add-pl-1")).toBeTruthy(),
    );
    fireEvent.press(online.view.getByTestId("plan-picker-add-pl-1"));
    expect(online.view.getByText("1 meal · about 2,450 kcal")).toBeTruthy();
    fireEvent.press(online.view.getByTestId("plan-remove-pl-1"));
    online.view.unmount();

    const offline = open("meal_plan", {});
    offline.h.netInfo.setConnected(false);
    await waitFor(() =>
      expect(
        offline.view.getByText(
          "Your Library needs a connection. Try again when you're back online.",
        ),
      ).toBeTruthy(),
    );
  });

  it("resources: add from the Library, remove", async () => {
    const { h, view } = open("resource", {}, { online: true });
    h.api.setupResources = [
      {
        id: "r-1",
        kind: "file",
        title: "Squat depth",
        mime: "video/mp4",
        bytes: 1,
        archivedAt: null,
      },
      {
        id: "r-2",
        kind: "link",
        title: "Old",
        mime: null,
        bytes: null,
        archivedAt: "2026-01-01",
      },
    ];
    expect(
      view.getByText("Shown on Lena's Coach tab when they accept."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("resource-picker"));
    await waitFor(() =>
      expect(view.getByTestId("resource-picker-add-r-1")).toBeTruthy(),
    );
    expect(view.queryByTestId("resource-picker-add-r-2")).toBeNull();
    fireEvent.press(view.getByTestId("resource-picker-add-r-1"));
    expect(view.getByText("Video")).toBeTruthy();
    fireEvent.press(view.getByTestId("resource-remove-r-1"));
    expect(view.getByTestId("resource-picker-add-r-1")).toBeTruthy();
  });

  it("welcome: type, add the first name and programme name; Back saves trimmed", async () => {
    const { h, view } = open("welcome_message", {
      programme: [{ refId: "pr-1", config: {}, sortOrder: 0 }],
    });
    expect(
      view.getByText("Sent from you the moment Lena accepts."),
    ).toBeTruthy();
    fireEvent.changeText(view.getByTestId("welcome-text"), "Hi ");
    fireEvent.press(view.getByTestId("welcome-first"));
    fireEvent.press(view.getByTestId("welcome-programme"));
    fireEvent.press(view.getByTestId("section-back"));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(sent(h)[0]!.items).toEqual([
      {
        refId: null,
        config: { text: "Hi Lena Lean bulk · Upper / Lower" },
        sortOrder: 0,
      },
    ]);
  });

  it("an unknown section or profile shows a missing page", async () => {
    const h = setupClients({ online: false });
    mockParams = { profileId: "p-lena", section: "nope" };
    const view = h.render(<SetupSectionContainer />);
    expect(
      await view.findByText("We couldn't find this section."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("section-missing-bar-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe("C11s preview", () => {
  it("shows the welcome, forms first, the programme with Next and targets", async () => {
    const h = setupClients();
    h.storage.cacheCoachClientProfile(
      COACH,
      profile("p-lena", {
        setup: {
          ...FULL_SETUP,
          meal_plan: [{ refId: "pl-9", config: {}, sortOrder: 0 }],
        },
      }),
    );
    h.api.programDetail = programmeDetail("pr-1");
    mockParams = { profileId: "p-lena" };
    const view = h.render(<ClientPreviewContainer />);
    expect(
      view.getByText("Preview: what Lena sees when they accept"),
    ).toBeTruthy();
    expect(view.getByTestId("preview-welcome")).toBeTruthy();
    expect(view.getByText("New client: goals and health")).toBeTruthy();
    expect(view.getByText("Fill in")).toBeTruthy();
    expect(view.getByText("2,100 kcal · 150 g protein")).toBeTruthy();
    expect(view.getAllByText("Meal plan")).toHaveLength(2);
    expect(view.getByText("2 resources")).toBeTruthy();
    await waitFor(() => expect(view.getByText("Next: Upper A")).toBeTruthy());
    expect(
      view.getByText("Your coach from today · Lean bulk · Upper / Lower"),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("preview-close"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("renders an empty preview when the profile isn't on this phone", () => {
    const h = setupClients({ online: false });
    mockParams = { profileId: "p-x" };
    const view = h.render(<ClientPreviewContainer />);
    expect(view.getByText("Your coach from today")).toBeTruthy();
    expect(view.queryByText("Fill in")).toBeNull();
    expect(Text).toBeTruthy();
  });
});
