import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import type {
  AthleteResource,
  CoachResource,
} from "@/domain/models/coachResources";
import type { TrainerClient } from "@/domain/models/trainerClient";
import { CoachResourcesLibraryContainer } from "@/ui/containers/coachResources/CoachResourcesLibraryContainer";
import { useOpenResource } from "@/ui/containers/coachResources/useOpenResource";
import { useMyResources } from "@/ui/hooks/useCoachResources";
import { CoachTabResources } from "@/ui/presenters/coachResources/CoachTabResources";
import { Text } from "react-native";
import {
  COACH,
  setupCoachForms,
} from "@/ui/containers/__tests__/coachFormsTestKit";

jest.mock("@/ui/hooks/imagePicker", () => ({
  chooseImageSource: jest.fn(async () => null),
  pickImage: jest.fn(),
}));

function res(over: Partial<CoachResource> = {}): CoachResource {
  return {
    id: "r1",
    kind: "file",
    title: "Shopping list",
    url: null,
    mediaId: "m1",
    mime: "application/pdf",
    bytes: 1000,
    revision: 1,
    archivedAt: null,
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  };
}

const LIB = [
  res(),
  res({
    id: "r2",
    kind: "link",
    title: "Studio booking",
    url: "https://studio.example",
    mediaId: null,
    mime: null,
    bytes: null,
  }),
];

function client(id: string, name: string, status: "active" | "pending") {
  return {
    id,
    name,
    initials: "X",
    avatarUrl: null,
    status,
    programLabel: null,
    programEndDate: null,
  } as unknown as TrainerClient;
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

type Btn = { text: string; onPress?: () => unknown };
async function pressAlert(text: string) {
  const buttons = alertSpy.mock.calls.at(-1)![2] as Btn[];
  await act(async () => {
    await buttons.find((b) => b.text === text)!.onPress?.();
  });
}

function setupLibrary(opts: { online?: boolean } = {}) {
  const h = setupCoachForms(opts);
  h.api.coachResources = LIB.map((r) => ({ ...r }));
  h.api.trainerClients = [
    client("c-sam", "Sam Patel", "active"),
    client("c-priya", "Priya Shah", "active"),
    client("c-pete", "Pending Pete", "pending"),
  ];
  const view = h.render(<CoachResourcesLibraryContainer />);
  return { ...h, view };
}

describe("Library → Resources on iPhone", () => {
  it("lists, counts, filters and searches", async () => {
    const { view } = setupLibrary();
    await waitFor(() => view.getByTestId("resources-library-row-r1"));
    expect(view.getByText("PDF · 1 KB · added 20 Oct")).toBeTruthy();
    expect(
      view.getByTestId("resources-library-filter-link").props
        .accessibilityLabel,
    ).toBe("Links, 1");
    fireEvent.press(view.getByTestId("resources-library-filter-link"));
    expect(view.queryByTestId("resources-library-row-r1")).toBeNull();
    fireEvent.press(view.getByTestId("resources-library-filter-all"));
    fireEvent.changeText(view.getByTestId("resources-library-search"), "zz");
    expect(view.getByText("Nothing matches.")).toBeTruthy();
    // Pull to refresh.
    await act(async () => {
      view
        .getByTestId("resources-library")
        .props.refreshControl.props.onRefresh();
    });
  });

  it("empty library says how to start", async () => {
    const h = setupCoachForms();
    const view = h.render(<CoachResourcesLibraryContainer />);
    await waitFor(() => view.getByTestId("resources-library-empty"));
    expect(view.getByText(/No resources yet/)).toBeTruthy();
  });

  it("Share with several active clients at once", async () => {
    const { view, api } = setupLibrary();
    await waitFor(() => view.getByTestId("resources-library-row-r2"));
    fireEvent.press(view.getByTestId("resources-library-row-r2"));
    await pressAlert("Share with clients");
    expect(view.queryByTestId("share-resource-client-c-pete")).toBeNull();
    fireEvent.changeText(view.getByTestId("share-resource-search"), "pri");
    expect(view.queryByTestId("share-resource-client-c-sam")).toBeNull();
    fireEvent.changeText(view.getByTestId("share-resource-search"), "");
    fireEvent.press(view.getByTestId("share-resource-client-c-sam"));
    fireEvent.press(view.getByTestId("share-resource-client-c-priya"));
    fireEvent.press(view.getByTestId("share-resource-client-c-priya"));
    fireEvent.press(view.getByTestId("share-resource-client-c-priya"));
    await act(async () => {
      fireEvent.press(view.getByTestId("share-resource-save"));
    });
    expect(api.resourceCalls).toContain("assign:r2>c-sam,c-priya");
    expect(
      view.getByText("Shared Studio booking with 2 clients."),
    ).toBeTruthy();
    fireEvent.press(view.getByTestId("resources-library-notice-dismiss"));
  });

  it("Share refused: resources_off names the client; other refusals too", async () => {
    const { view, api } = setupLibrary();
    api.resourcesOffClients.add("c-sam");
    api.resourceFailures.assign.push({ kind: "other", message: "Nope" });
    await waitFor(() => view.getByTestId("resources-library-row-r1"));
    fireEvent.press(view.getByTestId("resources-library-row-r1"));
    await pressAlert("Share with clients");
    fireEvent.press(view.getByTestId("share-resource-client-c-sam"));
    await act(async () => {
      fireEvent.press(view.getByTestId("share-resource-save"));
    });
    expect(view.getByText("Nope")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId("share-resource-save"));
    });
    expect(
      view.getByText(
        /Resources are switched off for Sam, so nothing was shared/,
      ),
    ).toBeTruthy();
  });

  it("Share offline queues one assign per client", async () => {
    const { view, storage, netInfo, server, api } = setupLibrary();
    await waitFor(() => view.getByTestId("resources-library-row-r1"));
    server.offline = true;
    storage.cacheCoachClientResources(COACH, "c-sam", []);
    await act(async () => {
      netInfo.setConnected(false);
    });
    expect(view.getByTestId("resources-library-offline")).toBeTruthy();
    fireEvent.press(view.getByTestId("resources-library-row-r1"));
    await pressAlert("Share with clients");
    fireEvent.press(view.getByTestId("share-resource-client-c-sam"));
    fireEvent.press(view.getByTestId("share-resource-client-c-priya"));
    await act(async () => {
      fireEvent.press(view.getByTestId("share-resource-save"));
    });
    expect(api.resourceCalls.some((c) => c.startsWith("assign"))).toBe(false);
    expect(
      storage
        .getUncompletedMutations()
        .filter((e) => e.endpoint.endsWith("/assign")),
    ).toHaveLength(2);
    expect(storage.getCachedCoachClientResources(COACH, "c-sam")).toHaveLength(
      1,
    );
  });

  it("online share adds to a cached client tab", async () => {
    const { view, storage } = setupLibrary();
    storage.cacheCoachClientResources(COACH, "c-sam", []);
    await waitFor(() => view.getByTestId("resources-library-row-r1"));
    fireEvent.press(view.getByTestId("resources-library-row-r1"));
    await pressAlert("Share with clients");
    fireEvent.press(view.getByTestId("share-resource-client-c-sam"));
    await act(async () => {
      fireEvent.press(view.getByTestId("share-resource-save"));
    });
    expect(storage.getCachedCoachClientResources(COACH, "c-sam")).toHaveLength(
      1,
    );
    fireEvent.press(view.getByTestId("resources-library-row-r1"));
    await pressAlert("Share with clients");
    fireEvent.press(view.getByTestId("share-resource-client-c-sam"));
    expect(view.getByTestId("share-resource-sheet")).toBeTruthy();
  });

  it("Delete: confirm removes it (from every client); Keep; failure; offline; still-saving link", async () => {
    const { view, api, netInfo, storage } = setupLibrary();
    storage.cacheCoachClientResources(COACH, "c-sam", [
      {
        assignmentId: "a1",
        clientId: "c-sam",
        resource: LIB[0]!,
        assignedAt: "2026-10-21T00:00:00Z",
        openedAt: null,
      },
    ]);
    await waitFor(() => view.getByTestId("resources-library-row-r1"));
    fireEvent.press(view.getByTestId("resources-library-row-r1"));
    await pressAlert("Delete");
    expect(alertSpy.mock.calls.at(-1)![1]).toBe(
      "It's removed from your Library and from every client who has it.",
    );
    await pressAlert("Delete");
    expect(api.resourceCalls).toContain("archive:r1");
    expect(storage.getCachedCoachClientResources(COACH, "c-sam")).toEqual([]);
    await waitFor(() =>
      expect(view.queryByTestId("resources-library-row-r1")).toBeNull(),
    );

    api.resourceFailures.archive.push({
      kind: "api",
      code: "server",
      message: "Locked",
    });
    fireEvent.press(view.getByTestId("resources-library-row-r2"));
    await pressAlert("Delete");
    await pressAlert("Delete");
    expect(alertSpy.mock.calls.at(-1)!.slice(0, 2)).toEqual([
      "Couldn't delete it",
      "Locked",
    ]);

    await act(async () => {
      storage.cacheCoachResources(COACH, [res({ id: "local-l", title: "L" })]);
      storage.emitChange("cached_coach_resources");
    });
    await waitFor(() => view.getByTestId("resources-library-row-local-l"));
    fireEvent.press(view.getByTestId("resources-library-row-local-l"));
    await pressAlert("Delete");
    await pressAlert("Delete");
    expect(alertSpy.mock.calls.at(-1)![1]).toBe(
      "This link is still saving. Try again in a moment.",
    );
    await act(async () => {
      netInfo.setConnected(false);
    });
    fireEvent.press(view.getByTestId("resources-library-row-local-l"));
    await pressAlert("Delete");
    await pressAlert("Delete");
    expect(alertSpy.mock.calls.at(-1)![0]).toBe("You're offline");
  });

  it("Add link adds to the library", async () => {
    const { view, api } = setupLibrary();
    await waitFor(() => view.getByTestId("resources-library-row-r1"));
    fireEvent.press(view.getByTestId("resources-library-link"));
    fireEvent.changeText(view.getByTestId("link-resource-title"), "New");
    fireEvent.changeText(
      view.getByTestId("link-resource-url"),
      "https://new.example",
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    expect(api.resourceCalls).toContain("create:link:New");
    expect(view.getByText("Added New to your Library.")).toBeTruthy();
    expect(api.resourceCalls.some((c) => c.startsWith("assign"))).toBe(false);
    // Upload opens the photo picker (cancelled here).
    await act(async () => {
      fireEvent.press(view.getByTestId("resources-library-upload"));
    });
    expect(view.queryByTestId("name-resource-title")).toBeNull();
  });
});

// ── Athlete ──────────────────────────────────────────────────────────────────

function mine(over: Partial<AthleteResource> = {}): AthleteResource {
  return {
    assignmentId: "a1",
    resourceId: "r1",
    kind: "link",
    title: "Booking",
    url: "https://studio.example",
    urlExpiresAt: null,
    mime: null,
    bytes: null,
    coach: { id: "t1", name: "Ellie", avatarUrl: null },
    assignedAt: "2026-11-20T09:00:00.000Z",
    openedAt: null,
    ...over,
  };
}

function Harness() {
  const resources = useMyResources();
  const open = useOpenResource(resources);
  return (
    <>
      <CoachTabResources
        firstName="Ellie"
        rows={resources.data}
        onOpen={(id) => void open(id)}
      />
      <Text testID="opened">
        {(resources.data ?? []).map((r) => r.openedAt ?? "-").join(",")}
      </Text>
    </>
  );
}

describe("Athlete resources (Coach tab)", () => {
  let openSpy: jest.SpyInstance;
  beforeEach(() => {
    openSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  });
  afterEach(() => openSpy.mockRestore());

  it("shows the coach's resources with a count; opening a link stamps opened (queued)", async () => {
    const h = setupCoachForms();
    h.api.myResources = [mine()];
    const view = h.render(<Harness />);
    await waitFor(() => view.getByTestId("coach-tab-resource-a1"));
    expect(view.getByTestId("coach-tab-resources-count").props.children).toBe(
      1,
    );
    expect(view.getByText("Link · studio.example")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId("coach-tab-resource-a1"));
    });
    expect(openSpy).toHaveBeenCalledWith("https://studio.example");
    expect(h.storage.getCachedMyResources(COACH)![0]!.openedAt).not.toBeNull();
    expect(
      h.server.calls.some((c) =>
        c.url.endsWith("/users/me/resources/a1/opened"),
      ),
    ).toBe(true);
    // Unknown id: nothing happens.
  });

  it("empty and loading states", async () => {
    const h = setupCoachForms();
    const view = h.render(<Harness />);
    expect(view.getByTestId("coach-tab-resources-loading")).toBeTruthy();
    await waitFor(() => view.getByTestId("coach-tab-resources-empty"));
  });

  it("an expired file link is fetched again before opening", async () => {
    const h = setupCoachForms();
    h.storage.cacheMyResources(COACH, [
      mine({
        kind: "file",
        url: "https://bucket.test/old",
        urlExpiresAt: "2000-01-01T00:00:00Z",
        mime: "application/pdf",
      }),
    ]);
    h.api.myResources = [
      mine({
        kind: "file",
        url: "https://bucket.test/new",
        urlExpiresAt: "2099-01-01T00:00:00Z",
        mime: "application/pdf",
      }),
    ];
    h.api.resourceFailures.mine.push({
      kind: "api",
      code: "network",
      message: "x",
    });
    const view = h.render(<Harness />);
    await waitFor(() => view.getByTestId("coach-tab-resource-a1"));
    await act(async () => {
      fireEvent.press(view.getByTestId("coach-tab-resource-a1"));
    });
    expect(openSpy).toHaveBeenCalledWith("https://bucket.test/new");
  });

  it("offline with an expired file link says a connection is needed; an unavailable file and a failed open say so", async () => {
    const h = setupCoachForms({ online: false });
    const old = mine({
      kind: "file",
      url: "https://bucket.test/old",
      urlExpiresAt: "2000-01-01T00:00:00Z",
    });
    h.storage.cacheMyResources(COACH, [old]);
    h.api.resourceFailures.mine.push({
      kind: "api",
      code: "network",
      message: "x",
    });
    const view = h.render(<Harness />);
    await waitFor(() => view.getByTestId("coach-tab-resource-a1"));
    await act(async () => {
      fireEvent.press(view.getByTestId("coach-tab-resource-a1"));
    });
    expect(alertSpy.mock.calls.at(-1)![0]).toBe("You're offline");
    expect(openSpy).not.toHaveBeenCalled();
    view.unmount();

    const h2 = setupCoachForms();
    h2.storage.cacheMyResources(COACH, [old]);
    h2.api.myResources = [old];
    const v2 = h2.render(<Harness />);
    await waitFor(() => v2.getByTestId("coach-tab-resource-a1"));
    await act(async () => {
      fireEvent.press(v2.getByTestId("coach-tab-resource-a1"));
    });
    expect(alertSpy.mock.calls.at(-1)![0]).toBe("Couldn't open it");
    v2.unmount();

    const h3 = setupCoachForms();
    h3.api.myResources = [mine()];
    openSpy.mockRejectedValueOnce(new Error("no app"));
    const v3 = h3.render(<Harness />);
    await waitFor(() => v3.getByTestId("coach-tab-resource-a1"));
    await act(async () => {
      fireEvent.press(v3.getByTestId("coach-tab-resource-a1"));
    });
    expect(alertSpy.mock.calls.at(-1)!.slice(0, 2)).toEqual([
      "Couldn't open it",
      "Try again in a moment.",
    ]);
    expect(h3.storage.getCachedMyResources(COACH)![0]!.openedAt).toBeNull();
  });
});
