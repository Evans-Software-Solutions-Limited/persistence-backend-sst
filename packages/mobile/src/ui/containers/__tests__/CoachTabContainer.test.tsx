import { act, fireEvent } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { MyCoach } from "@/domain/models/myCoaching";
import { ok } from "@/shared/errors";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type {
  AthleteFormRequest,
  LocalFormState,
} from "@/domain/models/athleteForms";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  CoachTabContainer,
  coachingSince,
} from "@/ui/containers/CoachTabContainer";

const mockParams: { coachId?: string; nav?: string } = {};
const mockFocus: { cb: (() => void | (() => void)) | null } = { cb: null };
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = jest.requireActual("react") as typeof import("react");
    mockFocus.cb = cb;
    React.useEffect(() => cb(), [cb]);
  },
}));

const FEATURES = {
  nutrition: true,
  checkIns: true,
  photos: true,
  habits: true,
  messages: true,
  resources: true,
};

function coach(id: string, name: string, since: string | null): MyCoach {
  return {
    relationshipId: id,
    trainerId: `t-${id}`,
    name,
    avatarUrl: null,
    since,
    features: FEATURES,
    due: { forms: 0 },
    newPlans: 0,
    resources: 0,
  };
}

const ELLIE = coach("rel-ellie", "Ellie Hart", "2026-08-04T09:00:00Z");
const MARCUS = coach("rel-marcus", "Marcus Lee", "2026-09-12T09:00:00Z");

function setup(opts: {
  server: MyCoach[];
  cached?: MyCoach[] | null;
  requests?: AthleteFormRequest[];
  locals?: LocalFormState[];
  online?: boolean;
}) {
  const api = new InMemoryApiAdapter();
  api.myCoaching = { coaches: opts.server, asOf: "2026-11-23T09:00:00Z" };
  api.formRequests = { requests: opts.requests ?? [], asOf: "a" };
  const storage = new InMemoryStorageAdapter();
  for (const l of opts.locals ?? []) {
    storage.saveLocalFormState("athlete-1", l);
    // A form waiting to send has a live queue row (its response).
    if (l.submittedAt && !l.sentAt) {
      storage.enqueueMutation({
        entityType: "form_response",
        entityId: `athlete-1:${l.requestId}`,
        operation: "create",
        payload: { answers: {} },
        endpoint: `/users/me/form-requests/${l.requestId}/response`,
        method: "POST",
      });
    }
  }
  const netInfo = new InMemoryNetInfoAdapter(opts.online ?? true);
  if (opts.cached) {
    storage.cacheMyCoaches("athlete-1", {
      coaches: opts.cached,
      asOf: "2026-11-22T09:00:00Z",
    });
  }
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "athlete-1",
    email: "a@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo,
  };
  const tree = () => (
    <AdapterProvider adapters={adapters}>
      <CoachTabContainer />
    </AdapterProvider>
  );
  const utils = renderWithTheme(tree());
  /** Re-render as a new navigation to the (still mounted) tab would. */
  const renavigate = () => utils.rerender(tree());
  return { api, storage, netInfo, renavigate, ...utils };
}

describe("CoachTabContainer", () => {
  beforeEach(() => {
    delete mockParams.coachId;
    delete mockParams.nav;
  });

  it("one coach: C2e header, no chips", async () => {
    const utils = setup({ server: [ELLIE] });
    await act(async () => {});
    expect(utils.getByText("Ellie Hart")).toBeTruthy();
    expect(utils.getByText("Coaching you since August")).toBeTruthy();
    expect(utils.queryByTestId("coach-tab-chips")).toBeNull();
    expect(utils.api.getMyCoachingCalls).toBeGreaterThan(0);
  });

  it("two coaches: one chip each, the first selected, a tap switches coach", async () => {
    const utils = setup({ server: [ELLIE, MARCUS] });
    await act(async () => {});
    expect(utils.getByTestId("coach-tab-chips")).toBeTruthy();
    const ellieChip = utils.getByTestId("coach-tab-chip-rel-ellie");
    const marcusChip = utils.getByTestId("coach-tab-chip-rel-marcus");
    expect(ellieChip.props.accessibilityState?.selected).toBe(true);
    expect(marcusChip.props.accessibilityState?.selected).toBe(false);

    fireEvent.press(marcusChip);
    expect(utils.getByTestId("coach-tab-header").props.children).toBeTruthy();
    expect(utils.getByText("Coaching you since September")).toBeTruthy();
    expect(
      utils.getByTestId("coach-tab-chip-rel-marcus").props.accessibilityState
        ?.selected,
    ).toBe(true);
  });

  it("opens on the coach named by ?coachId= (You → Coaching)", async () => {
    mockParams.coachId = "rel-marcus";
    const utils = setup({ server: [ELLIE, MARCUS] });
    await act(async () => {});
    expect(
      utils.getByTestId("coach-tab-chip-rel-marcus").props.accessibilityState
        ?.selected,
    ).toBe(true);
  });

  it("tapping the same coach again on You overrides an earlier chip choice (Inspector Brad, #547)", async () => {
    mockParams.coachId = "rel-ellie";
    mockParams.nav = "1";
    const utils = setup({ server: [ELLIE, MARCUS] });
    await act(async () => {});
    fireEvent.press(utils.getByTestId("coach-tab-chip-rel-marcus"));
    expect(
      utils.getByTestId("coach-tab-chip-rel-marcus").props.accessibilityState
        ?.selected,
    ).toBe(true);

    // Back to You, tap Ellie again: same coachId, new navigation.
    mockParams.nav = "2";
    utils.renavigate();
    await act(async () => {});
    expect(
      utils.getByTestId("coach-tab-chip-rel-ellie").props.accessibilityState
        ?.selected,
    ).toBe(true);

    // A chip tap still wins within that navigation.
    fireEvent.press(utils.getByTestId("coach-tab-chip-rel-marcus"));
    expect(
      utils.getByTestId("coach-tab-chip-rel-marcus").props.accessibilityState
        ?.selected,
    ).toBe(true);
  });

  it("ending coaching with one coach removes their chip and shows the other", async () => {
    const utils = setup({ server: [ELLIE, MARCUS] });
    await act(async () => {});
    fireEvent.press(utils.getByTestId("coach-tab-chip-rel-marcus"));

    // Leaving Marcus (ProfileContainer) ends it on the server and drops him
    // from the cache; the tab re-reads the table straight away.
    await utils.api.leaveCoach("rel-marcus");
    await act(async () => {
      utils.storage.removeCachedMyCoach("athlete-1", "rel-marcus");
      utils.storage.emitChange("cached_my_coaches");
    });
    await act(async () => {});

    expect(utils.queryByTestId("coach-tab-chip-rel-marcus")).toBeNull();
    expect(utils.queryByTestId("coach-tab-chips")).toBeNull();
    expect(utils.getByText("Ellie Hart")).toBeTruthy();
  });

  it("a coach who ended coaching from their side goes on the next focus refresh", async () => {
    const utils = setup({ server: [ELLIE, MARCUS] });
    await act(async () => {});
    utils.api.myCoaching = { coaches: [ELLIE], asOf: "2026-11-23T10:00:00Z" };
    await act(async () => {
      mockFocus.cb?.();
    });
    expect(utils.queryByTestId("coach-tab-chip-rel-marcus")).toBeNull();
    expect(utils.storage.getCachedMyCoaches("athlete-1")?.coaches).toEqual([
      ELLIE,
    ]);
  });

  it("offline: shows the cached coaches", async () => {
    const utils = setup({ server: [], cached: [ELLIE, MARCUS] });
    utils.api.shouldFail = true;
    utils.api.failError = { kind: "api", code: "network", message: "offline" };
    await act(async () => {});
    expect(utils.getByTestId("coach-tab-chip-rel-ellie")).toBeTruthy();
    expect(utils.getByTestId("coach-tab-chip-rel-marcus")).toBeTruthy();
  });

  it("marks every not-yet-built C2e section as in development", async () => {
    const utils = setup({ server: [ELLIE] });
    await act(async () => {});
    for (const key of ["messages", "plan", "resources"]) {
      expect(utils.getByTestId(`coach-tab-dev-${key}`)).toBeTruthy();
    }
    expect(utils.getByText("Your plan from Ellie")).toBeTruthy();
    expect(utils.getAllByText(/In development/).length).toBe(3);
    expect(utils.queryByTestId("coach-tab-dev-forms")).toBeNull();
  });

  it("pull to refresh re-reads the coaches", async () => {
    const utils = setup({ server: [ELLIE] });
    await act(async () => {});
    const before = utils.api.getMyCoachingCalls;
    await act(async () => {
      utils.getByTestId("coach-tab").props.refreshControl.props.onRefresh();
    });
    expect(utils.api.getMyCoachingCalls).toBe(before + 1);
  });
});

function formRequest(
  id: string,
  extra: Partial<AthleteFormRequest> = {},
): AthleteFormRequest {
  return {
    id,
    formId: `f-${id}`,
    title: `Form ${id}`,
    description: null,
    coach: { id: "t-rel-ellie", name: "Ellie Hart" },
    trigger: "weekly",
    periodKey: "p",
    sentAt: "2026-11-23T09:00:00Z",
    dueAt: null,
    closesAt: null,
    status: "pending",
    late: false,
    version: {
      id: "v",
      version: 1,
      questions: [{ id: "e", type: "scale", prompt: "Energy", required: true }],
    },
    ...extra,
  };
}

function waiting(id: string): LocalFormState {
  return {
    requestId: id,
    title: `Form ${id}`,
    coachId: "t-rel-ellie",
    trigger: "daily",
    answers: { q0: 3 },
    step: 0,
    updatedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    sentAt: null,
    closed: false,
    rejected: null,
    submitKey: null,
    uploadKeys: {},
    introSeen: true,
  };
}

describe("CoachTabContainer — forms (PER-130, C10p/q/r)", () => {
  beforeEach(() => {
    delete mockParams.coachId;
    delete mockParams.nav;
    mockPush.mockClear();
  });

  it("due forms lead the tab for the selected coach; Fill in opens the form", async () => {
    const utils = setup({
      server: [ELLIE, MARCUS],
      requests: [
        formRequest("a"),
        formRequest("m", { coach: { id: "t-rel-marcus", name: "Marcus" } }),
      ],
    });
    await act(async () => {});
    expect(utils.getByTestId("coach-forms-to-fill")).toBeTruthy();
    expect(utils.getByText("Form a")).toBeTruthy();
    expect(utils.queryByText("Form m")).toBeNull();
    expect(utils.getByText("No due date")).toBeTruthy();

    fireEvent.press(utils.getByTestId("coach-form-fill-a"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/forms/[id]",
      params: { id: "a" },
    });

    fireEvent.press(utils.getByTestId("coach-tab-chip-rel-marcus"));
    expect(utils.getByText("Form m")).toBeTruthy();
    expect(utils.queryByText("Form a")).toBeNull();
  });

  it("offline: a form sent from this phone waits, with the C10r note", async () => {
    const utils = setup({
      server: [ELLIE],
      online: false,
      requests: [formRequest("a"), formRequest("d")],
      locals: [waiting("d")],
    });
    await act(async () => {});
    expect(utils.getByTestId("coach-forms-offline")).toBeTruthy();
    expect(
      utils.getByText(
        "You’re offline. Form d is saved on this phone and sends when you’re back.",
      ),
    ).toBeTruthy();
    expect(utils.getByText("Waiting")).toBeTruthy();
    expect(utils.getByText(/^Waiting to send · saved/)).toBeTruthy();
    expect(utils.queryByTestId("coach-form-card-d")).toBeNull();
  });

  it("online with nothing waiting: no offline note", async () => {
    const utils = setup({ server: [ELLIE], requests: [formRequest("a")] });
    await act(async () => {});
    expect(utils.queryByTestId("coach-forms-offline")).toBeNull();
  });

  it("opens the joining forms page once, while they're untouched (C10q)", async () => {
    const utils = setup({
      server: [ELLIE],
      requests: [formRequest("j", { trigger: "on_join" })],
    });
    await act(async () => {});
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/forms/joining",
      params: { coachId: "t-rel-ellie" },
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockFocus.cb?.();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("doesn't open it once seen", async () => {
    setup({
      server: [ELLIE],
      requests: [formRequest("j", { trigger: "on_join" })],
      locals: [{ ...waiting("j"), submittedAt: null, answers: {} }],
    });
    await act(async () => {});
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("pull to refresh also re-reads the forms", async () => {
    const utils = setup({ server: [ELLIE] });
    await act(async () => {});
    const before = utils.api.getMyFormRequestsCalls;
    await act(async () => {
      utils.getByTestId("coach-tab").props.refreshControl.props.onRefresh();
    });
    expect(utils.api.getMyFormRequestsCalls).toBe(before + 1);
  });
});

describe("coachingSince", () => {
  const now = new Date("2026-11-23T12:00:00");

  it("today, this year, an earlier year, and no date", () => {
    expect(
      coachingSince(new Date("2026-11-23T08:00:00").toISOString(), now),
    ).toBe("Your coach from today");
    expect(coachingSince("2026-03-02T09:00:00", now)).toBe(
      "Coaching you since March",
    );
    expect(coachingSince("2025-10-02T09:00:00", now)).toBe(
      "Coaching you since October 2025",
    );
    expect(coachingSince(null, now)).toBe("Your coach");
    expect(coachingSince("not a date", now)).toBe("Your coach");
  });
});
