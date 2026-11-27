import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type {
  ClientResource,
  CoachResource,
} from "@/domain/models/coachResources";
import { ClientResourcesContainer } from "@/ui/containers/coachResources/ClientResourcesContainer";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  COACH,
  setupCoachForms,
} from "@/ui/containers/__tests__/coachFormsTestKit";

const mockChoose = jest.fn();
const mockPick = jest.fn();
jest.mock("@/ui/hooks/imagePicker", () => ({
  chooseImageSource: (...a: unknown[]) => mockChoose(...a),
  pickImage: (...a: unknown[]) => mockPick(...a),
}));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: jest.fn(async () => ({
    uri: "file:///converted.jpg",
    width: 2048,
    height: 1536,
  })),
}));
const mockRead = jest.fn();
jest.mock("@/shared/utils/localFile", () => ({
  readLocalFile: (...a: unknown[]) => mockRead(...a),
}));

const CLIENT = "client-sam";

function res(over: Partial<CoachResource> = {}): CoachResource {
  return {
    id: "r1",
    kind: "file",
    title: "Shopping list",
    url: null,
    mediaId: "m1",
    mime: "application/pdf",
    bytes: 2_516_582,
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
    url: "https://studio.example/book",
    mediaId: null,
    mime: null,
    bytes: null,
  }),
  res({
    id: "r3",
    title: "Hip hinge drill",
    mime: "image/jpeg",
    bytes: 860_000,
  }),
];

function row(r: CoachResource, over: Partial<ClientResource> = {}) {
  return {
    assignmentId: `as-${r.id}`,
    clientId: CLIENT,
    resource: r,
    assignedAt: "2026-10-20T10:00:00.000Z",
    openedAt: null,
    ...over,
  } satisfies ClientResource;
}

function setup(opts: { online?: boolean } = {}) {
  const h = setupCoachForms(opts);
  h.api.coachResources = LIB.map((r) => ({ ...r }));
  h.api.coachClientResources.set(CLIENT, [
    row(LIB[0]!, { openedAt: "2026-10-21T08:00:00.000Z" }),
    row(LIB[1]!),
  ]);
  const view = h.render(
    <ClientResourcesContainer clientId={CLIENT} clientName="Sam Patel" />,
  );
  return { ...h, view };
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockChoose.mockReset();
  mockPick.mockReset();
  mockRead.mockReset();
});
afterEach(() => alertSpy.mockRestore());

/** Press the named button of the last Alert. */
async function pressAlert(text: string) {
  const buttons = alertSpy.mock.calls.at(-1)![2] as {
    text: string;
    onPress?: () => unknown;
  }[];
  await act(async () => {
    await buttons.find((b) => b.text === text)!.onPress?.();
  });
}

describe("Client → Resources on iPhone (C3.7b/c)", () => {
  it("lists what Sam has with opened / not opened", async () => {
    const { view } = setup();
    await waitFor(() =>
      expect(view.getByTestId("client-resource-as-r1")).toBeTruthy(),
    );
    expect(view.getByText("Shopping list")).toBeTruthy();
    expect(view.getByText("PDF · shared 20 Oct")).toBeTruthy();
    expect(view.getByText("Opened")).toBeTruthy();
    expect(view.getByText("Not opened")).toBeTruthy();
  });

  it("empty: says nothing is shared yet", async () => {
    const h = setupCoachForms();
    const view = h.render(
      <ClientResourcesContainer clientId={CLIENT} clientName={null} />,
    );
    await waitFor(() =>
      expect(view.getByTestId("client-resources-empty")).toBeTruthy(),
    );
    expect(view.getByText(/Nothing shared with your client yet/)).toBeTruthy();
  });

  it("Add resources: picker shows only what Sam lacks; tick and Add 1 shares online", async () => {
    const { view, api, storage } = setup();
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    await waitFor(() =>
      expect(view.getByTestId("add-resources-row-r3")).toBeTruthy(),
    );
    expect(view.queryByTestId("add-resources-row-r2")).toBeNull();
    expect(view.getByText("Image · 840 KB")).toBeTruthy();
    fireEvent.press(view.getByTestId("add-resources-row-r3"));
    expect(
      view.getByTestId("add-resources-row-r3").props.accessibilityState
        ?.checked,
    ).toBe(true);
    await act(async () => {
      fireEvent.press(view.getByTestId("add-resources-add"));
    });
    expect(api.resourceCalls).toContain(`assign:r3>${CLIENT}`);
    await waitFor(() =>
      expect(view.getByText("Shared 1 resource with Sam.")).toBeTruthy(),
    );
    expect(
      storage
        .getCachedCoachClientResources(COACH, CLIENT)!
        .map((a) => a.resource.id),
    ).toContain("r3");
  });

  it("share online, then Remove straight away, uses the server's assignment id", async () => {
    const { view, api } = setup();
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    await waitFor(() => view.getByTestId("add-resources-row-r3"));
    fireEvent.press(view.getByTestId("add-resources-row-r3"));
    await act(async () => {
      fireEvent.press(view.getByTestId("add-resources-add"));
    });
    const row = `client-resource-srv-as-${CLIENT}-r3`;
    await waitFor(() => expect(view.getByTestId(row)).toBeTruthy());
    fireEvent.press(view.getByTestId(row));
    await pressAlert("Remove");
    expect(api.resourceCalls).toContain(`remove:${CLIENT}:srv-as-${CLIENT}-r3`);
    expect(view.getByText("Removed Hip hinge drill from Sam.")).toBeTruthy();
  });

  it("a link create that times out is queued under the same key, so the replay can't add a second link", async () => {
    const { view, api, storage, server } = setup();
    api.resourceFailures.create.push({
      kind: "api",
      code: "timeout",
      message: "Request timed out",
    });
    server.offline = true;
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    fireEvent.press(view.getByTestId("add-resources-link"));
    fireEvent.changeText(view.getByTestId("link-resource-title"), "Booking");
    fireEvent.changeText(
      view.getByTestId("link-resource-url"),
      "https://studio.example",
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    const sent = api.resourceKeysSent[0]!;
    const create = storage
      .getUncompletedMutations()
      .find((e) => e.endpoint === "/trainers/me/resources")!;
    expect(create.idempotencyKey).toBe(sent);
    // The queued replay carries that key.
    server.offline = false;
    for (const e of (
      storage as unknown as { queue: { nextAttemptAt: string | null }[] }
    ).queue) {
      e.nextAttemptAt = null;
    }
    const { processSyncQueue } = jest.requireActual(
      "@/application/commands/sync.command",
    ) as typeof import("@/application/commands/sync.command");
    await act(async () => {
      await processSyncQueue(
        storage,
        { getAccessToken: async () => "t" } as never,
        "https://api.test",
      );
    });
    const replays = server.calls.filter(
      (c) => c.url.endsWith("/trainers/me/resources") && c.method === "POST",
    );
    expect(new Set(replays.map((c) => c.key))).toEqual(new Set([sent]));
  });

  it("search narrows the picker; untick works", async () => {
    const { view } = setup();
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    await waitFor(() => view.getByTestId("add-resources-row-r3"));
    fireEvent.press(view.getByTestId("add-resources-row-r3"));
    fireEvent.press(view.getByTestId("add-resources-row-r3"));
    expect(
      view.getByTestId("add-resources-add").props.accessibilityState?.disabled,
    ).toBe(true);
    fireEvent.changeText(view.getByTestId("add-resources-search"), "zzz");
    expect(view.getByText("Nothing matches that search.")).toBeTruthy();
  });

  it("403 resources_off is shown clearly in the sheet", async () => {
    const { view, api } = setup();
    api.resourcesOffClients.add(CLIENT);
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    await waitFor(() => view.getByTestId("add-resources-row-r3"));
    fireEvent.press(view.getByTestId("add-resources-row-r3"));
    await act(async () => {
      fireEvent.press(view.getByTestId("add-resources-add"));
    });
    expect(view.getByTestId("add-resources-error")).toBeTruthy();
    expect(
      view.getByText(
        "Resources are switched off for Sam, so nothing was shared. Switch Resources on in Sam's settings to share.",
      ),
    ).toBeTruthy();
  });

  it("other refusals: not your client, deleted, other", async () => {
    const { view, api } = setup();
    api.resourceFailures.assign.push(
      { kind: "not_your_client", clientIds: [CLIENT] },
      { kind: "not_found" },
      { kind: "other", message: "Server trouble" },
    );
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    await waitFor(() => view.getByTestId("add-resources-row-r3"));
    fireEvent.press(view.getByTestId("add-resources-row-r3"));
    for (const text of [
      "Sam isn't one of your active clients any more.",
      "That resource was deleted. Refresh and try again.",
      "Server trouble",
    ]) {
      await act(async () => {
        fireEvent.press(view.getByTestId("add-resources-add"));
      });
      expect(view.getByText(text)).toBeTruthy();
    }
  });

  it("offline: a share is queued, shows at once, and a later resources_off refusal is noted and dismissable", async () => {
    const { view, api, storage, server, netInfo } = setup();
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    server.offline = true;
    await act(async () => {
      netInfo.setConnected(false);
    });
    await waitFor(() =>
      expect(view.getByTestId("client-resources-offline")).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId("client-resources-add"));
    await waitFor(() => view.getByTestId("add-resources-row-r3"));
    expect(view.getByTestId("add-resources-offline")).toBeTruthy();
    expect(
      view.getByTestId("add-resources-upload").props.accessibilityState
        ?.disabled,
    ).toBe(true);
    fireEvent.press(view.getByTestId("add-resources-row-r3"));
    await act(async () => {
      fireEvent.press(view.getByTestId("add-resources-add"));
    });
    expect(api.resourceCalls.some((c) => c.startsWith("assign:"))).toBe(false);
    const queued = storage
      .getUncompletedMutations()
      .filter((e) => e.endpoint === "/trainers/me/resources/assign");
    expect(queued).toHaveLength(1);
    expect(view.getByText("Hip hinge drill")).toBeTruthy();
    // The server later refuses it with resources_off.
    storage.markMutationFailed(
      queued[0]!.id,
      'HTTP 403: {"code":"resources_off"}',
    );
    // The tab re-reads on its next cache write.
    await act(async () => {
      storage.emitChange("cached_coach_client_resources");
    });
    await waitFor(() =>
      expect(view.getByTestId("client-resources-refused")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("client-resources-refused-dismiss"));
    });
    expect(view.queryByTestId("client-resources-refused")).toBeNull();
    expect(
      storage
        .getCachedCoachClientResources(COACH, CLIENT)!
        .map((a) => a.resource.id),
    ).not.toContain("r3");
  });

  it("tap a row → Remove (online) takes it off; Keep does nothing", async () => {
    const { view, api } = setup();
    await waitFor(() => view.getByTestId("client-resource-as-r2"));
    fireEvent.press(view.getByTestId("client-resource-as-r2"));
    expect(alertSpy.mock.calls.at(-1)![0]).toBe("Remove Studio booking?");
    await pressAlert("Keep");
    fireEvent.press(view.getByTestId("client-resource-as-r2"));
    await pressAlert("Remove");
    expect(api.resourceCalls).toContain(`remove:${CLIENT}:as-r2`);
    await waitFor(() =>
      expect(view.queryByTestId("client-resource-as-r2")).toBeNull(),
    );
    expect(view.getByText("Removed Studio booking from Sam.")).toBeTruthy();
    fireEvent.press(view.getByTestId("client-resources-notice-dismiss"));
    expect(view.queryByTestId("client-resources-notice")).toBeNull();
  });

  it("Remove: a failure says why; offline needs a connection; a still-syncing row waits", async () => {
    const { view, api, netInfo, storage } = setup();
    api.resourceFailures.remove.push({
      kind: "api",
      code: "server",
      message: "Nope",
    });
    await waitFor(() => view.getByTestId("client-resource-as-r2"));
    fireEvent.press(view.getByTestId("client-resource-as-r2"));
    await pressAlert("Remove");
    expect(alertSpy.mock.calls.at(-1)!.slice(0, 2)).toEqual([
      "Couldn't remove it",
      "Nope",
    ]);
    // A row still being shared.
    await act(async () => {
      storage.cacheCoachClientResources(COACH, CLIENT, [
        row(LIB[2]!, { assignmentId: "local-x" }),
      ]);
      storage.emitChange("cached_coach_client_resources");
    });
    await waitFor(() => view.getByTestId("client-resource-local-x"));
    fireEvent.press(view.getByTestId("client-resource-local-x"));
    await pressAlert("Remove");
    expect(alertSpy.mock.calls.at(-1)![1]).toBe(
      "This is still being shared. Try again in a moment.",
    );
    await act(async () => {
      netInfo.setConnected(false);
    });
    fireEvent.press(view.getByTestId("client-resource-local-x"));
    await pressAlert("Remove");
    expect(alertSpy.mock.calls.at(-1)![0]).toBe("You're offline");
  });

  it("Link: a 422 lands on the field, then it's added to the library and shared", async () => {
    const { view, api } = setup();
    api.resourceFailures.create.push({
      kind: "api",
      code: "server",
      status: 422,
      message: "That resource can't be saved",
      body: {
        code: "invalid_resource",
        errors: [{ at: "url", message: "must be an https link" }],
      },
    });
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    fireEvent.press(view.getByTestId("add-resources-link"));
    await waitFor(() => view.getByTestId("link-resource-sheet"));
    // The schema first.
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    expect(view.getByTestId("link-resource-title-error")).toBeTruthy();
    fireEvent.changeText(view.getByTestId("link-resource-title"), "Etiquette");
    fireEvent.changeText(
      view.getByTestId("link-resource-url"),
      "https://studio.example/etiquette",
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    expect(
      view.getByText("Enter a full link starting with https://"),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    expect(api.resourceCalls).toContain("create:link:Etiquette");
    await waitFor(() =>
      expect(view.getByText("Added Etiquette for Sam.")).toBeTruthy(),
    );
    expect(api.resourceCalls.some((c) => c.startsWith("assign:srv-res-"))).toBe(
      true,
    );
  });

  it("Link: other failures show in the sheet; close it", async () => {
    const { view, api } = setup();
    api.resourceFailures.create.push({
      kind: "api",
      code: "server",
      status: 500,
      message: "Boom",
    });
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    fireEvent.press(view.getByTestId("add-resources-link"));
    fireEvent.changeText(view.getByTestId("link-resource-title"), "A");
    fireEvent.changeText(
      view.getByTestId("link-resource-url"),
      "https://a.example",
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    expect(view.getByTestId("link-resource-error")).toBeTruthy();
    expect(view.getByText("Boom")).toBeTruthy();
  });

  it("Link offline: queued as local, shared via the queue, then swapped when it syncs", async () => {
    const { view, api, storage, server, netInfo } = setup();
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    server.offline = true;
    await act(async () => {
      netInfo.setConnected(false);
    });
    fireEvent.press(view.getByTestId("client-resources-add"));
    fireEvent.press(view.getByTestId("add-resources-link"));
    expect(view.getByTestId("link-resource-offline")).toBeTruthy();
    fireEvent.changeText(view.getByTestId("link-resource-title"), "Booking");
    fireEvent.changeText(
      view.getByTestId("link-resource-url"),
      "https://studio.example",
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    expect(api.resourceCalls.some((c) => c.startsWith("create:"))).toBe(false);
    const queued = storage.getUncompletedMutations();
    expect(queued.map((e) => e.endpoint)).toEqual([
      "/trainers/me/resources",
      "/trainers/me/resources/assign",
    ]);
    expect(view.getByText("Added Booking for Sam.")).toBeTruthy();
    // Back online: the drain sends the create, swaps the id, then the assign.
    server.offline = false;
    server.replyData = (call) =>
      call.url.endsWith("/trainers/me/resources")
        ? {
            ...res({ id: "srv-new", kind: "link", title: "Booking" }),
            url: "https://studio.example",
          }
        : { created: 1 };
    await act(async () => {
      netInfo.setConnected(true);
    });
    const { processSyncQueue } = jest.requireActual(
      "@/application/commands/sync.command",
    ) as typeof import("@/application/commands/sync.command");
    // Skip the offline back-off window.
    for (const e of (
      storage as unknown as { queue: { nextAttemptAt: string | null }[] }
    ).queue) {
      e.nextAttemptAt = null;
    }
    await act(async () => {
      await processSyncQueue(
        storage,
        { getAccessToken: async () => "t" } as never,
        "https://api.test",
      );
    });
    const assign = server.calls.findLast((c) => c.url.endsWith("/assign"));
    expect(assign?.body).toEqual({
      resourceIds: ["srv-new"],
      clientIds: [CLIENT],
    });
  });

  it("Upload: the app's photo picker, a name, then upload + share", async () => {
    const { view, api } = setup();
    mockChoose.mockResolvedValue("library");
    mockPick.mockResolvedValue({
      status: "picked",
      asset: {
        uri: "file:///a.heic",
        width: 4000,
        height: 3000,
        fileName: "Gym.HEIC",
      },
    });
    mockRead.mockResolvedValue({ size: 1234 } as Blob);
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    await act(async () => {
      fireEvent.press(view.getByTestId("add-resources-upload"));
    });
    await waitFor(() => view.getByTestId("name-resource-sheet"));
    expect(view.getByTestId("name-resource-title").props.value).toBe("Gym");
    fireEvent.changeText(view.getByTestId("name-resource-title"), "");
    await act(async () => {
      fireEvent.press(view.getByTestId("name-resource-save"));
    });
    expect(view.getByTestId("name-resource-title-error")).toBeTruthy();
    fireEvent.changeText(view.getByTestId("name-resource-title"), "Gym map");
    await act(async () => {
      fireEvent.press(view.getByTestId("name-resource-save"));
    });
    expect(mockRead).toHaveBeenCalledWith("file:///converted.jpg");
    expect(api.resourceCalls).toEqual(
      expect.arrayContaining(["upload:image/jpeg:1234", "create:file:Gym map"]),
    );
    expect(api.resourceCalls.some((c) => c.startsWith("put:"))).toBe(true);
    await waitFor(() =>
      expect(view.getByText("Added Gym map for Sam.")).toBeTruthy(),
    );
  });

  it("Upload: cancelled, denied, unreadable, network and server failures", async () => {
    const { view, api } = setup();
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    const open = async () => {
      fireEvent.press(view.getByTestId("client-resources-add"));
      await act(async () => {
        fireEvent.press(view.getByTestId("add-resources-upload"));
      });
    };
    mockChoose.mockResolvedValueOnce(null);
    await open();
    expect(view.queryByTestId("name-resource-title")).toBeNull();
    mockChoose.mockResolvedValue("camera");
    mockPick.mockResolvedValueOnce({ status: "denied" });
    await open();
    expect(alertSpy.mock.calls.at(-1)![0]).toBe("Permission required");
    mockPick.mockResolvedValueOnce({ status: "cancelled" });
    await open();
    expect(view.queryByTestId("name-resource-title")).toBeNull();

    mockPick.mockResolvedValue({
      status: "picked",
      asset: { uri: "file:///b.jpg" },
    });
    mockRead.mockRejectedValueOnce(new Error("gone"));
    await open();
    expect(view.getByTestId("name-resource-title").props.value).toMatch(
      /^Image /,
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("name-resource-save"));
    });
    expect(view.getByText("That photo couldn't be read.")).toBeTruthy();

    mockRead.mockResolvedValue({ size: 10 } as Blob);
    api.resourceFailures.upload.push({
      kind: "api",
      code: "network",
      message: "x",
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("name-resource-save"));
    });
    expect(
      view.getByText(
        "Uploading needs a connection. Try again when you're back online.",
      ),
    ).toBeTruthy();
    api.resourceFailures.put.push({
      kind: "api",
      code: "server",
      message: "Storage said no",
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("name-resource-save"));
    });
    expect(view.getByText("Storage said no")).toBeTruthy();
    api.resourceFailures.create.push({
      kind: "api",
      code: "server",
      status: 422,
      message: "",
      body: { errors: [{ at: "title", message: "bad" }] },
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("name-resource-save"));
    });
    expect(view.getByTestId("name-resource-title-error")).toBeTruthy();
    api.resourceFailures.create.push({
      kind: "api",
      code: "server",
      status: 500,
      message: "",
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("name-resource-save"));
    });
    expect(view.getByText("We couldn't upload that photo.")).toBeTruthy();
  });

  it("a refused share after Link reopens the picker with the reason", async () => {
    const { view, api } = setup();
    api.resourcesOffClients.add(CLIENT);
    await waitFor(() => view.getByTestId("client-resource-as-r1"));
    fireEvent.press(view.getByTestId("client-resources-add"));
    fireEvent.press(view.getByTestId("add-resources-link"));
    fireEvent.changeText(view.getByTestId("link-resource-title"), "A");
    fireEvent.changeText(
      view.getByTestId("link-resource-url"),
      "https://a.example",
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("link-resource-save"));
    });
    await waitFor(() =>
      expect(view.getByTestId("add-resources-error")).toBeTruthy(),
    );
  });

  it("pull-to-refresh key re-reads both lists", async () => {
    const h = setupCoachForms();
    h.api.coachResources = [...LIB];
    const view = h.render(
      <ClientResourcesContainer clientId={CLIENT} clientName="Sam" />,
    );
    await waitFor(() => view.getByTestId("client-resources-empty"));
    const before = h.api.resourceCalls.length;
    view.rerender(
      <AdapterProvider adapters={h.adapters}>
        <ClientResourcesContainer
          clientId={CLIENT}
          clientName="Sam"
          refreshKey={1}
        />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(h.api.resourceCalls.length).toBeGreaterThan(before),
    );
  });
});
