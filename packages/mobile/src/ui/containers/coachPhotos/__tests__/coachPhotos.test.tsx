import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { CoachPhotosApiError } from "@/domain/models/coachProgressPhotos";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ProgressPhotoSet } from "@/domain/models/progressPhotos";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { COACH_PHOTOS_REFRESH_MS } from "@/ui/hooks/useCoachClientPhotos";
import { ClientPhotosContainer } from "../ClientPhotosContainer";
import { ClientPhotoCompareContainer } from "../ClientPhotoCompareContainer";
import { firstNameOf, photosState, showingOffline } from "../coachPhotoViews";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: {
  id?: string;
  name?: string;
  pose?: string;
  setId?: string;
} = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
const mockProfile: { weightUnit: "kg" | "lb" | null } = { weightUnit: null };
jest.mock("@/ui/hooks/useProfilePage", () => ({
  useProfilePage: () => ({
    payload: mockProfile.weightUnit
      ? { profile: { weightUnit: mockProfile.weightUnit } }
      : null,
  }),
}));

type Node = ReturnType<ReturnType<typeof renderWithTheme>["getByTestId"]>;

/** Every string under a rendered node, joined. */
function textOf(node: Node): string {
  return node.children
    .map((c: string | Node) => (typeof c === "string" ? c : textOf(c)))
    .join("");
}

function widthOf(node: Node): unknown {
  return StyleSheet.flatten(node.props.style)?.width;
}

const COACH = "coach-1";
const CLIENT = "client-1";

function serverSet(
  id: string,
  takenOn: string,
  kg: number | null = null,
  bodyFat: number | null = null,
): ProgressPhotoSet {
  return {
    id,
    takenOn,
    source: "self",
    status: "ready",
    createdAt: `${takenOn}T09:00:00.000Z`,
    updatedAt: `${takenOn}T09:00:00.000Z`,
    photos: (["front", "side", "back"] as const).map((pose) => ({
      id: `${id}-${pose}`,
      pose,
      bytes: 10,
      width: null,
      height: null,
      url: `https://view.test/${id}/${pose}.jpg?sig=1`,
      expiresAt: "2026-11-27T10:05:00.000Z",
    })),
    weight: kg == null ? null : { kg, measuredAt: `${takenOn}T07:00:00.000Z` },
    bodyFat:
      bodyFat == null
        ? null
        : { percentage: bodyFat, measuredAt: `${takenOn}T07:00:00.000Z` },
  };
}

const CANVAS = [
  serverSet("s26", "2026-10-26", 82.4, 14.5),
  serverSet("s19", "2026-10-19", 82.0),
  serverSet("s12", "2026-10-12"),
  serverSet("s05", "2026-10-05"),
  serverSet("s28", "2026-09-28"),
  serverSet("s15", "2026-09-15", 80.2, 15.2),
];

function denied(denial: CoachPhotosApiError["denial"]): CoachPhotosApiError {
  return { kind: "api", code: "server", status: 403, message: "No", denial };
}

function setup(opts: { online?: boolean } = {}) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: COACH,
    email: "c@example.com",
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
  const netInfo = {
    isConnected: jest.fn(async () => opts.online ?? true),
    subscribe: jest.fn(() => () => {}),
  } as unknown as Adapters["netInfo"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo,
  };
  const wrap = (ui: React.ReactElement) => (
    <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>
  );
  const render = (ui: React.ReactElement) => renderWithTheme(wrap(ui));
  return { api, storage, render, wrap };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockParams)) {
    delete mockParams[k as keyof typeof mockParams];
  }
  mockProfile.weightUnit = null;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("C3.4b Photos tab (PER-138)", () => {
  const tab = () => (
    <ClientPhotosContainer clientId={CLIENT} clientName="Sam Patel" />
  );

  it("shows the latest set, then the earlier sets, and caches the read", async () => {
    const { api, storage, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    const view = render(tab());
    expect(await view.findByText("Latest · 26 Oct")).toBeTruthy();
    expect(api.coachClientPhotoCalls).toEqual([CLIENT]);
    expect(view.getByText("All sets · 5")).toBeTruthy();
    for (const d of ["19 Oct", "12 Oct", "5 Oct", "28 Sep", "15 Sep"]) {
      expect(view.getByText(d)).toBeTruthy();
    }
    // Images are cached by photo id, never by the expiring link.
    const front = view.getByTestId("client-photos-latest-Front");
    expect(front).toBeTruthy();
    expect(
      storage.getCachedCoachClientPhotos(COACH, CLIENT)?.sets,
    ).toHaveLength(6);
  });

  it("Compare, a latest photo and an earlier set open the compare", async () => {
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    const view = render(tab());
    await view.findByText("Latest · 26 Oct");
    fireEvent.press(view.getByTestId("client-photos-compare"));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/(app)/clients/[id]/photos-compare",
      params: { id: CLIENT, name: "Sam Patel" },
    });
    fireEvent.press(view.getByTestId("client-photos-latest-Side"));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/(app)/clients/[id]/photos-compare",
      params: { id: CLIENT, name: "Sam Patel", pose: "side" },
    });
    fireEvent.press(view.getByTestId("client-photos-set-s12"));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/(app)/clients/[id]/photos-compare",
      params: { id: CLIENT, name: "Sam Patel", setId: "s12" },
    });
  });

  it("one set: no Compare, and the latest photos don't open it", async () => {
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, [CANVAS[0]!]);
    const view = render(
      <ClientPhotosContainer clientId={CLIENT} clientName={null} />,
    );
    await view.findByText("Latest · 26 Oct");
    expect(view.queryByTestId("client-photos-compare")).toBeNull();
    expect(view.queryByTestId("client-photos-all")).toBeNull();
    fireEvent.press(view.getByTestId("client-photos-latest-Front"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("no photos yet", async () => {
    const { render } = setup();
    const view = render(tab());
    expect(await view.findByTestId("client-photos-empty")).toBeTruthy();
    expect(view.getByText("No photos yet")).toBeTruthy();
  });

  it.each([
    ["not_shared", "Sam hasn't shared photos with you"],
    ["photos_off", "Photos are off for Sam"],
    ["ended", "Coaching has ended"],
  ] as const)("refused: %s", async (denial, title) => {
    const { api, storage, render } = setup();
    // Photos seen before stay hidden once the server refuses.
    storage.cacheCoachClientPhotos(COACH, CLIENT, {
      sets: CANVAS,
      asOf: "2026-11-26T10:00:00.000Z",
    });
    api.coachClientPhotoFailures.push(denied(denial));
    const view = render(tab());
    expect(await view.findByText(title)).toBeTruthy();
    expect(view.getByTestId(`client-photos-${denial}`)).toBeTruthy();
    expect(view.queryByText("Latest · 26 Oct")).toBeNull();
    expect(storage.getCachedCoachClientPhotos(COACH, CLIENT)).toBeNull();
  });

  it("offline: shows the last read with a note; images already viewed come from the cache", async () => {
    const { api, storage, render } = setup({ online: false });
    storage.cacheCoachClientPhotos(COACH, CLIENT, {
      sets: CANVAS,
      asOf: "2026-11-26T10:00:00.000Z",
    });
    api.coachClientPhotoFailures.push({
      kind: "api",
      code: "network",
      message: "offline",
    });
    const view = render(tab());
    expect(view.getByText("Latest · 26 Oct")).toBeTruthy();
    expect(await view.findByTestId("client-photos-offline")).toBeTruthy();
  });

  it("offline with nothing on the phone, then a server failure, can be retried", async () => {
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    api.coachClientPhotoFailures.push(
      { kind: "api", code: "timeout", message: "slow" },
      { kind: "api", code: "server", status: 500, message: "boom" },
    );
    const view = render(tab());
    expect(await view.findByTestId("client-photos-offline_empty")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-photos-retry"));
    expect(await view.findByTestId("client-photos-error")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-photos-retry"));
    expect(await view.findByText("Latest · 26 Oct")).toBeTruthy();
  });

  it("reads again on pull-to-refresh and every 4 minutes, for fresh links", async () => {
    jest.useFakeTimers();
    const { api, render, wrap } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    const view = render(tab());
    await waitFor(() => expect(api.coachClientPhotoCalls).toHaveLength(1));
    view.rerender(
      wrap(
        <ClientPhotosContainer
          clientId={CLIENT}
          clientName="Sam Patel"
          refreshKey={1}
        />,
      ),
    );
    await waitFor(() => expect(api.coachClientPhotoCalls).toHaveLength(2));
    await act(async () => {
      jest.advanceTimersByTime(COACH_PHOTOS_REFRESH_MS);
    });
    await waitFor(() => expect(api.coachClientPhotoCalls).toHaveLength(3));
    view.unmount();
  });
});

describe("C3.4c photo compare (PER-138)", () => {
  beforeEach(() => {
    mockParams.id = CLIENT;
    mockParams.name = "Sam Patel";
  });

  it("compares the first and latest front photos, with the strip and all dates", async () => {
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    const view = render(<ClientPhotoCompareContainer />);
    expect(await view.findByText("15 Sep ▾")).toBeTruthy();
    expect(view.getByText("26 Oct ▾")).toBeTruthy();
    expect(view.getByLabelText("Front · 15 Sep")).toBeTruthy();
    expect(view.getByLabelText("Front · 26 Oct")).toBeTruthy();
    expect(textOf(view.getByTestId("photo-compare-weight"))).toBe(
      "80.2→82.4Weight kg",
    );
    expect(textOf(view.getByTestId("photo-compare-bodyfat"))).toBe(
      "15.2→14.5Body fat %",
    );
    expect(textOf(view.getByTestId("photo-compare-apart"))).toBe("6wkApart");
    expect(view.getByText("All dates · 6 sets")).toBeTruthy();
    expect(
      view.getByText(
        "Only you and Sam see these. They disappear for you if coaching ends.",
      ),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("photo-compare-back"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("opens on a set against the latest, on the chosen pose, in the coach's unit", async () => {
    mockParams.setId = "s19";
    mockParams.pose = "back";
    mockProfile.weightUnit = "lb";
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    const view = render(<ClientPhotoCompareContainer />);
    expect(await view.findByLabelText("Back · 19 Oct")).toBeTruthy();
    expect(view.getByLabelText("Back · 26 Oct")).toBeTruthy();
    expect(textOf(view.getByTestId("photo-compare-weight"))).toBe(
      "180.8→181.7Weight lb",
    );
    expect(textOf(view.getByTestId("photo-compare-apart"))).toBe("1wkApart");
  });

  it("switches pose, picks dates from the dropdowns and the thumbnails", async () => {
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    const view = render(<ClientPhotoCompareContainer />);
    await view.findByText("15 Sep ▾");
    fireEvent.press(view.getByTestId("photo-compare-pose-Side"));
    expect(view.getByLabelText("Side · 15 Sep")).toBeTruthy();

    // The earlier date's list leaves out the later date.
    fireEvent.press(view.getByTestId("photo-compare-older"));
    expect(view.queryByTestId("photo-compare-older-dates-s26")).toBeNull();
    fireEvent.press(view.getByTestId("photo-compare-older-dates-s28"));
    expect(view.getByText("28 Sep ▾")).toBeTruthy();
    expect(view.queryByTestId("photo-compare-older-dates")).toBeNull();

    fireEvent.press(view.getByTestId("photo-compare-newer"));
    fireEvent.press(view.getByTestId("photo-compare-newer-dates-s12"));
    expect(view.getByText("12 Oct ▾")).toBeTruthy();
    expect(textOf(view.getByTestId("photo-compare-apart"))).toBe("2wkApart");

    // A thumbnail replaces the earlier side; the pair stays oldest first.
    fireEvent.press(view.getByTestId("photo-compare-thumb-s19"));
    expect(view.getByText("12 Oct ▾")).toBeTruthy();
    expect(view.getByText("19 Oct ▾")).toBeTruthy();
    expect(
      view.getByTestId("photo-compare-thumb-s19").props.accessibilityState,
    ).toMatchObject({ selected: true });
    // The later side's own thumbnail does nothing.
    fireEvent.press(view.getByTestId("photo-compare-thumb-s19"));
    expect(view.getByText("12 Oct ▾")).toBeTruthy();
  });

  it("wipes between the two dates by dragging, or with accessibility actions", async () => {
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, CANVAS);
    const view = render(<ClientPhotoCompareContainer />);
    await view.findByText("15 Sep ▾");
    fireEvent.press(view.getByTestId("photo-compare-mode"));
    fireEvent.press(view.getByTestId("photo-compare-modes-wipe"));
    expect(view.getByText("Wipe ▾")).toBeTruthy();
    const wipe = view.getByTestId("photo-compare-wipe");
    fireEvent(wipe, "layout", {
      nativeEvent: { layout: { width: 350, height: 300, x: 0, y: 0 } },
    });
    expect(widthOf(view.getByTestId("photo-compare-wipe-older"))).toBe(175);
    fireEvent(wipe, "responderMove", { nativeEvent: { locationX: 70 } });
    expect(widthOf(view.getByTestId("photo-compare-wipe-older"))).toBe(70);
    fireEvent(wipe, "responderGrant", { nativeEvent: { locationX: 9999 } });
    expect(widthOf(view.getByTestId("photo-compare-wipe-older"))).toBe(350);
    fireEvent(wipe, "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(wipe.props.accessibilityValue).toMatchObject({ now: 90 });
    fireEvent(wipe, "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(wipe.props.accessibilityValue).toMatchObject({ now: 100 });
    fireEvent.press(view.getByTestId("photo-compare-mode"));
    fireEvent.press(view.getByTestId("photo-compare-modes-side"));
    expect(view.queryByTestId("photo-compare-wipe")).toBeNull();
  });

  it("one set: says compare needs two dates", async () => {
    const { api, render } = setup();
    api.coachClientPhotoSets.set(CLIENT, [CANVAS[0]!]);
    const view = render(<ClientPhotoCompareContainer />);
    expect(await view.findByText("Compare needs two dates")).toBeTruthy();
    expect(view.queryByTestId("photo-compare-mode")).toBeNull();
  });

  it("coaching ended while open: the photos go", async () => {
    const { api, storage, render } = setup();
    storage.cacheCoachClientPhotos(COACH, CLIENT, {
      sets: CANVAS,
      asOf: "2026-11-26T10:00:00.000Z",
    });
    api.coachClientPhotoFailures.push(denied("ended"));
    const view = render(<ClientPhotoCompareContainer />);
    expect(await view.findByText("Coaching has ended")).toBeTruthy();
    expect(view.queryByText("15 Sep ▾")).toBeNull();
  });

  it("offline with photos on the phone keeps comparing; with none, can retry", async () => {
    const first = setup({ online: false });
    first.storage.cacheCoachClientPhotos(COACH, CLIENT, {
      sets: CANVAS,
      asOf: "2026-11-26T10:00:00.000Z",
    });
    first.api.coachClientPhotoFailures.push({
      kind: "api",
      code: "network",
      message: "offline",
    });
    const view = first.render(<ClientPhotoCompareContainer />);
    expect(await view.findByTestId("photo-compare-offline")).toBeTruthy();
    expect(view.getByText("15 Sep ▾")).toBeTruthy();
    view.unmount();

    const second = setup();
    second.api.coachClientPhotoSets.set(CLIENT, CANVAS);
    second.api.coachClientPhotoFailures.push({
      kind: "api",
      code: "network",
      message: "offline",
    });
    const empty = second.render(<ClientPhotoCompareContainer />);
    expect(
      await empty.findByTestId("photo-compare-state-offline_empty"),
    ).toBeTruthy();
    fireEvent.press(empty.getByTestId("photo-compare-retry"));
    expect(await empty.findByText("15 Sep ▾")).toBeTruthy();
  });
});

describe("coach photo views", () => {
  it("first names, states and the offline flag", () => {
    expect(firstNameOf("Sam Patel")).toBe("Sam");
    expect(firstNameOf("  ")).toBe("Your client");
    expect(firstNameOf(undefined)).toBe("Your client");
    const base = { denial: null, hasData: false, sets: [], error: null };
    expect(photosState(base, true)).toBe("loading");
    expect(
      photosState(
        { ...base, error: { kind: "api", code: "server", message: "x" } },
        false,
      ),
    ).toBe("offline_empty");
    expect(showingOffline({ hasData: true, error: null }, false)).toBe(true);
    expect(showingOffline({ hasData: true, error: null }, true)).toBe(false);
    expect(showingOffline({ hasData: false, error: null }, false)).toBe(false);
  });
});
