import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { coachApi } from "../api/coachApi";
import { saveSession } from "../api/coachAuth";
import { ClientPage } from "../clients/ClientPage";
import { FormsLibrary } from "../forms/FormsLibrary";
import { ResourcesLibraryContainer } from "../resources/ResourcesLibraryContainer";
import {
  CLIENT_ID,
  CLIENT_RESOURCES,
  LIBRARY,
  ROSTER,
  apiError,
  fakeApi,
  renderCoach,
  resource,
  setOnline,
  settings,
} from "./helpers";

const PATH = "/coach/clients/:clientId/:tab?";
const ROUTE = `/coach/clients/${CLIENT_ID}/resources`;
const openTab = (api = fakeApi()) =>
  renderCoach(<ClientPage />, { route: ROUTE, path: PATH, api });
const openLibrary = (api = fakeApi()) =>
  renderCoach(<ResourcesLibraryContainer />, {
    route: "/coach/library/resources",
    path: "/coach/library/resources",
    api,
  });

const RESOURCES_OFF = apiError(403, {
  code: "resources_off",
  message: "Resources are switched off for this client",
  clientIds: [CLIENT_ID],
});

function pdf(name = "Travel workouts.pdf", size = 1200) {
  const f = new File([new Uint8Array(8)], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

beforeEach(() => setOnline(true));
afterEach(() => {
  cleanup();
  setOnline(true);
});

describe("Client → Resources (C3.7a)", () => {
  it("lists what Sam has with opened / not opened, and the picker beside it", async () => {
    openTab();
    expect(await screen.findByText("Sam has 2")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Resources" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    const list = screen.getByRole("region", { name: "Sam's resources" });
    expect(within(list).getByText("Shopping list · lean bulk")).toBeTruthy();
    expect(within(list).getByText("PDF · shared 20 Oct")).toBeTruthy();
    expect(within(list).getByText("Opened")).toBeTruthy();
    expect(within(list).getByText("Not opened")).toBeTruthy();
    const picker = screen.getByRole("region", {
      name: "Add resources for Sam",
    });
    // Only what Sam doesn't have yet.
    expect(await within(picker).findByText("Hip hinge drill")).toBeTruthy();
    expect(within(picker).queryByText("Studio booking page")).toBeNull();
    expect(within(picker).getByText("Image · 840 KB")).toBeTruthy();
    expect(
      within(picker).getByPlaceholderText("Search your 3 resources"),
    ).toBeTruthy();
    expect(
      within(picker).getByText(
        "Uploads go to your Library too, so you can share them again.",
      ),
    ).toBeTruthy();
  });

  it("ticks several and adds them for Sam", async () => {
    const api = fakeApi();
    openTab(api);
    const picker = await screen.findByRole("region", {
      name: "Add resources for Sam",
    });
    const add = within(picker).getByRole("button", { name: "Add for Sam" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await within(picker).findByRole("checkbox"));
    fireEvent.click(
      within(picker).getByRole("button", { name: "Add 1 for Sam" }),
    );
    await waitFor(() =>
      expect(api.assignResources).toHaveBeenCalledWith(
        ["res-3"],
        [CLIENT_ID],
        expect.any(String),
      ),
    );
    expect(await screen.findByText("Shared 1 resource with Sam.")).toBeTruthy();
    // The list is read again.
    await waitFor(() => expect(api.clientResources).toHaveBeenCalledTimes(2));
  });

  it("search narrows the picker, with an empty line when nothing matches", async () => {
    openTab();
    const box = await screen.findByPlaceholderText("Search your 3 resources");
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches that search.")).toBeTruthy();
    // The Add resources button takes you to the search.
    fireEvent.click(screen.getByRole("button", { name: "Add resources" }));
    expect(document.activeElement).toBe(box);
  });

  it("Resources switched off: says so up front, and a 403 resources_off is shown clearly", async () => {
    const api = fakeApi({
      settings: vi.fn().mockResolvedValue(
        settings({
          features: { ...settings().features, resources: false },
        }),
      ),
      assignResources: vi.fn().mockRejectedValue(RESOURCES_OFF),
    });
    openTab(api);
    expect(
      await screen.findByText(/Resources are switched off for Sam in Settings/),
    ).toBeTruthy();
    const picker = screen.getByRole("region", {
      name: "Add resources for Sam",
    });
    fireEvent.click(await within(picker).findByRole("checkbox"));
    fireEvent.click(
      within(picker).getByRole("button", { name: "Add 1 for Sam" }),
    );
    expect(
      await screen.findByText(
        "Resources are switched off for Sam, so nothing was shared. Switch Resources on in Sam's Settings to share.",
      ),
    ).toBeTruthy();
    // The coach can still remove items while it's off.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Studio booking page from Sam",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(api.removeClientResource).toHaveBeenCalledWith(CLIENT_ID, "as-2"),
    );
    expect(
      await screen.findByText("Removed Studio booking page from Sam."),
    ).toBeTruthy();
    expect(screen.queryByText("PDF · shared 6 Oct")).toBeNull();
    expect(screen.getByText("Sam has 1")).toBeTruthy();
  });

  it("remove: Keep closes the confirm, a failure says why", async () => {
    const api = fakeApi({
      removeClientResource: vi
        .fn()
        .mockRejectedValue(apiError(500, { message: "Server trouble" })),
    });
    openTab(api);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove Shopping list · lean bulk from Sam",
      }),
    );
    expect(
      screen.getByText("Sam won't see it any more. It stays in your Library."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Shopping list · lean bulk from Sam",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Server trouble")).toBeTruthy();
  });

  it("Link adds to the library and shares with Sam; 422s land on the fields", async () => {
    const created = resource({
      id: "res-new",
      kind: "link",
      title: "Gym etiquette",
      url: "https://studio.example/etiquette",
      mediaId: null,
      mime: null,
      bytes: null,
    });
    const api = fakeApi({
      createResource: vi
        .fn()
        .mockRejectedValueOnce(
          apiError(422, {
            code: "invalid_resource",
            errors: [{ at: "url", message: "must be an https link" }],
          }),
        )
        .mockResolvedValueOnce(created),
    });
    openTab(api);
    fireEvent.click(await screen.findByRole("button", { name: "Link" }));
    const dialog = screen.getByRole("dialog", { name: "Add a link" });
    // Client-side check first.
    fireEvent.click(within(dialog).getByRole("button", { name: "Add link" }));
    expect(await within(dialog).findByText(/Add a name/)).toBeTruthy();
    expect(api.createResource).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Gym etiquette" },
    });
    fireEvent.change(within(dialog).getByLabelText("Link"), {
      target: { value: "https://studio.example/etiquette" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add link" }));
    // The server's 422 on the link field.
    expect(
      await within(dialog).findByText(
        "Enter a full link starting with https://",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add link" }));
    await waitFor(() =>
      expect(api.assignResources).toHaveBeenCalledWith(
        ["res-new"],
        [CLIENT_ID],
        expect.any(String),
      ),
    );
    expect(api.createResource).toHaveBeenLastCalledWith(
      {
        kind: "link",
        title: "Gym etiquette",
        url: "https://studio.example/etiquette",
      },
      expect.any(String),
    );
    expect(
      await screen.findByText("Added Gym etiquette for Sam."),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Link: a non-field failure shows in the dialog; Cancel closes it", async () => {
    const api = fakeApi({
      createResource: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    openTab(api);
    fireEvent.click(await screen.findByRole("button", { name: "Link" }));
    const dialog = screen.getByRole("dialog", { name: "Add a link" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Booking" },
    });
    fireEvent.change(within(dialog).getByLabelText("Link"), {
      target: { value: "https://studio.example" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add link" }));
    expect(
      await within(dialog).findByText(
        "You're offline. Try again when you're back online.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Upload new: presigned upload, PUT, save, then share with Sam", async () => {
    const created = resource({ id: "res-up", title: "Travel workouts" });
    const upload = {
      url: "https://bucket.example/pending/x",
      method: "PUT" as const,
      headers: { "content-type": "application/pdf" },
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const api = fakeApi({
      createResourceUpload: vi.fn().mockResolvedValue({
        mediaId: "media-up",
        contentType: "application/pdf",
        bytes: 1200,
        status: "pending",
        upload,
      }),
      createResource: vi.fn().mockResolvedValue(created),
    });
    openTab(api);
    fireEvent.click(await screen.findByRole("button", { name: "Upload new" }));
    const dialog = screen.getByRole("dialog", { name: "Upload a file" });
    // Nothing chosen yet.
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(
      await within(dialog).findByText("Choose a file to upload."),
    ).toBeTruthy();
    const file = pdf();
    fireEvent.change(within(dialog).getByLabelText("File"), {
      target: { files: [file] },
    });
    // The name starts from the file name.
    expect(
      (within(dialog).getByLabelText("Name") as HTMLInputElement).value,
    ).toBe("Travel workouts");
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(api.assignResources).toHaveBeenCalledWith(
        ["res-up"],
        [CLIENT_ID],
        expect.any(String),
      ),
    );
    expect(api.createResourceUpload).toHaveBeenCalledWith(
      "application/pdf",
      1200,
      expect.any(String),
    );
    expect(api.putUpload).toHaveBeenCalledWith(upload, file);
    expect(api.createResource).toHaveBeenCalledWith(
      { kind: "file", title: "Travel workouts", mediaId: "media-up" },
      expect.any(String),
    );
  });

  it("Upload: a refused type lands on the file field; offline can't upload", async () => {
    const api = fakeApi({
      createResourceUpload: vi.fn().mockRejectedValue(
        apiError(422, {
          code: "invalid_upload",
          errors: [{ at: "bytes", message: "must be 1 to 26214400 bytes" }],
        }),
      ),
    });
    openTab(api);
    fireEvent.click(await screen.findByRole("button", { name: "Upload new" }));
    let dialog = screen.getByRole("dialog", { name: "Upload a file" });
    fireEvent.change(within(dialog).getByLabelText("File"), {
      target: { files: [pdf("a.pdf")] },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(
      await within(dialog).findByText("Files can be up to 25 MB."),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    setOnline(false);
    fireEvent.click(screen.getByRole("button", { name: "Upload new" }));
    dialog = screen.getByRole("dialog", { name: "Upload a file" });
    expect(
      within(dialog).getByText(/Uploading needs a connection/),
    ).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Upload",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("Upload: a failed upload shows the dialog banner", async () => {
    const api = fakeApi({
      createResourceUpload: vi
        .fn()
        .mockRejectedValue(apiError(500, { message: "Storage down" })),
    });
    openTab(api);
    fireEvent.click(await screen.findByRole("button", { name: "Upload new" }));
    const dialog = screen.getByRole("dialog", { name: "Upload a file" });
    fireEvent.change(within(dialog).getByLabelText("File"), {
      target: { files: [pdf()] },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await within(dialog).findByText("Storage down")).toBeTruthy();
  });

  it("empty states: nothing shared, empty library", async () => {
    openTab(
      fakeApi({
        clientResources: vi.fn().mockResolvedValue([]),
        resources: vi.fn().mockResolvedValue([]),
      }),
    );
    expect(await screen.findByText("Sam has 0")).toBeTruthy();
    expect(screen.getByText(/Nothing shared with Sam yet/)).toBeTruthy();
    expect(
      await screen.findByText(
        "Your Library has no resources yet. Upload a file or add a link.",
      ),
    ).toBeTruthy();
  });

  it("everything already shared says so", async () => {
    openTab(
      fakeApi({
        resources: vi.fn().mockResolvedValue(LIBRARY.slice(0, 2)),
      }),
    );
    expect(
      await screen.findByText("Sam already has everything in your Library."),
    ).toBeTruthy();
  });

  it("a failed load offers Try again; offline says so", async () => {
    const api = fakeApi({
      clientResources: vi
        .fn()
        .mockRejectedValueOnce(apiError(500, null))
        .mockResolvedValueOnce(CLIENT_RESOURCES),
    });
    openTab(api);
    expect(
      await screen.findByText("We couldn't load Sam's resources."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Sam has 2")).toBeTruthy();
    cleanup();
    setOnline(false);
    openTab(
      fakeApi({
        clientResources: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    expect(
      await screen.findByText(
        "You're offline. Sam's resources load when you're back online.",
      ),
    ).toBeTruthy();
  });

  it("offline with a cached list shows the offline banner", async () => {
    const view = openTab();
    expect(await screen.findByText("Sam has 2")).toBeTruthy();
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing Sam's resources as of/),
    ).toBeTruthy();
    expect(
      screen.getByText("Sharing and uploads need a connection."),
    ).toBeTruthy();
    view.unmount();
  });
});

describe("Library → Resources (C5b)", () => {
  it("lists the library with type and added date, and the first one selected", async () => {
    openLibrary();
    expect(
      await screen.findByRole("heading", { name: "Resources" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Resources" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: /All\s*3/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Files\s*2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Links\s*1/ })).toBeTruthy();
    const detail = screen.getByRole("region", {
      name: "Shopping list · lean bulk",
    });
    expect(within(detail).getByText("PDF · 2.4 MB")).toBeTruthy();
    // Selecting a link shows where it goes.
    fireEvent.click(
      screen.getByRole("button", { name: /Studio booking page/ }),
    );
    const link = screen.getByRole("region", { name: "Studio booking page" });
    expect(
      within(link).getByRole("link", { name: "studio.example" }),
    ).toBeTruthy();
  });

  it("filters by Links and searches", async () => {
    openLibrary();
    fireEvent.click(await screen.findByRole("button", { name: /Links\s*1/ }));
    expect(
      screen.queryByRole("button", { name: /Hip hinge drill/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Studio booking page/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /All\s*3/ }));
    fireEvent.change(screen.getByPlaceholderText("Search resources"), {
      target: { value: "nope" },
    });
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
    expect(
      screen.getByText("Pick a resource to share it or see its details."),
    ).toBeTruthy();
  });

  it("shares one resource with several clients at once", async () => {
    const api = fakeApi({
      roster: vi.fn().mockResolvedValue({
        ...ROSTER,
        data: [
          ...ROSTER.data,
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Priya Shah",
            initials: "PS",
            avatarUrl: null,
            status: "active",
            programLabel: null,
            lastSeenAt: null,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Pending Pete",
            initials: "PP",
            avatarUrl: null,
            status: "pending",
            programLabel: null,
            lastSeenAt: null,
          },
        ],
      }),
    });
    openLibrary(api);
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", {
      name: "Share Shopping list · lean bulk",
    });
    // Only active clients.
    expect(within(dialog).queryByText("Pending Pete")).toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText("Search clients"), {
      target: { value: "pri" },
    });
    expect(within(dialog).queryByText("Sam Patel")).toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText("Search clients"), {
      target: { value: "" },
    });
    const boxes = within(dialog).getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Share with 2 clients" }),
    );
    await waitFor(() =>
      expect(api.assignResources).toHaveBeenCalledWith(
        ["res-1"],
        [CLIENT_ID, "33333333-3333-4333-8333-333333333333"],
        expect.any(String),
      ),
    );
    expect(
      await screen.findByText(
        "Shared Shopping list · lean bulk with 2 clients.",
      ),
    ).toBeTruthy();
  });

  it("sharing with a client who has Resources off names them", async () => {
    const api = fakeApi({
      assignResources: vi.fn().mockRejectedValue(RESOURCES_OFF),
    });
    openLibrary(api);
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Share with 1 client" }),
    );
    expect(
      await within(dialog).findByText(
        /Resources are switched off for Sam, so nothing was shared/,
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("delete removes it from the library (and every client)", async () => {
    const api = fakeApi();
    openLibrary(api);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(
      screen.getByText(
        "It's removed from your Library and from every client who has it.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(api.archiveResource).toHaveBeenCalledWith("res-1"),
    );
    expect(
      await screen.findByText("Deleted Shopping list · lean bulk."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /All\s*2/ })).toBeTruthy();
  });

  it("a failed delete says why", async () => {
    openLibrary(
      fakeApi({
        archiveResource: vi
          .fn()
          .mockRejectedValue(apiError(500, { message: "Nope" })),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByText("Nope")).toBeTruthy();
  });

  it("Add link and Upload add to the library and select it", async () => {
    const link = resource({
      id: "res-l",
      kind: "link",
      title: "Booking",
      url: "https://studio.example",
      mediaId: null,
      mime: null,
      bytes: null,
      createdAt: "2026-11-25T09:00:00.000Z",
    });
    const api = fakeApi({
      createResource: vi
        .fn()
        .mockResolvedValueOnce(link)
        .mockResolvedValueOnce(resource({ id: "res-f", title: "Guide" })),
      createResourceUpload: vi.fn().mockResolvedValue({
        mediaId: "m",
        contentType: "application/pdf",
        bytes: 1200,
        status: "ready",
        upload: null,
      }),
    });
    openLibrary(api);
    fireEvent.click(await screen.findByRole("button", { name: "Add link" }));
    let dialog = screen.getByRole("dialog", { name: "Add a link" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Booking" },
    });
    fireEvent.change(within(dialog).getByLabelText("Link"), {
      target: { value: "https://studio.example" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add link" }));
    expect(
      await screen.findByText("Added Booking to your Library."),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Booking" })).toBeTruthy();
    expect(api.assignResources).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    dialog = screen.getByRole("dialog", { name: "Upload a file" });
    fireEvent.change(within(dialog).getByLabelText("File"), {
      target: { files: [pdf("Guide.pdf")] },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(
      await screen.findByText("Added Guide to your Library."),
    ).toBeTruthy();
    // An upload that was already complete skips the PUT.
    expect(api.putUpload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /All\s*5/ })).toBeTruthy();
  });

  it("empty library, failed load, offline", async () => {
    openLibrary(fakeApi({ resources: vi.fn().mockResolvedValue([]) }));
    expect(await screen.findByText(/No resources yet/)).toBeTruthy();
    cleanup();
    const api = fakeApi({
      resources: vi
        .fn()
        .mockRejectedValueOnce(apiError(500, null))
        .mockResolvedValue(LIBRARY),
    });
    openLibrary(api);
    expect(
      await screen.findByText("We couldn't load your resources."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Resources" }),
    ).toBeTruthy();
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing your resources as of/),
    ).toBeTruthy();
    expect(
      screen.getByText("Sharing and deleting need a connection."),
    ).toBeTruthy();
    cleanup();
    openLibrary(
      fakeApi({
        resources: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    );
    expect(
      await screen.findByText(
        "You're offline. Your resources load when you're back online.",
      ),
    ).toBeTruthy();
  });

  it("Forms keeps its Library tab and links to Resources", async () => {
    renderCoach(
      <FormsLibrary
        groups={{ on_join: [], repeating: [], once: [], on_end: [], none: [] }}
        stats={new Map()}
        totals={null}
        selected={null}
        templates={null}
        showTemplates={false}
        showAllOutstanding={false}
        offlineAsOf={null}
        notice={null}
        error={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onSend={vi.fn()}
        onChange={vi.fn()}
        onPreview={vi.fn()}
        onToggleTemplates={vi.fn()}
        onUseTemplate={vi.fn()}
        onToggleOutstanding={vi.fn()}
      />,
      {
        route: "/coach/library/forms",
        path: "/coach/library/forms",
        api: fakeApi(),
      },
    );
    expect(
      screen.getByRole("tab", { name: "Forms" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Resources" }).getAttribute("href"),
    ).toBe("/coach/library/resources");
  });
});

describe("coachApi resources calls", () => {
  it("routes: method, path, body and keys", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://auth.test/");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("VITE_CORE_API_URL", "https://api.test/");
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    saveSession({
      accessToken: `${b64({ alg: "HS256" })}.${b64({ exp })}.sig`,
      refreshToken: null,
      expiresAt: exp,
      email: null,
    });
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        if (url.endsWith("/resources") && !init?.method) {
          return new Response(JSON.stringify({ data: { resources: ["r"] } }));
        }
        return new Response(JSON.stringify({ data: "ok" }));
      }),
    );
    try {
      expect(await coachApi.resources()).toEqual(["r"]);
      await coachApi.createResource({ kind: "link", title: "T" }, "k1");
      await coachApi.archiveResource("r/1");
      await coachApi.assignResources(["r1"], ["c1"], "k2");
      expect(await coachApi.clientResources("c1")).toEqual(["r"]);
      await coachApi.removeClientResource("c1", "a1");
      await coachApi.createResourceUpload("image/png", 10, "k3");
      const seen = calls.map(
        (c) =>
          `${c.init?.method ?? "GET"} ${c.url.replace("https://api.test", "")}`,
      );
      expect(seen).toEqual([
        "GET /trainers/me/resources",
        "POST /trainers/me/resources",
        "DELETE /trainers/me/resources/r%2F1",
        "POST /trainers/me/resources/assign",
        "GET /trainers/me/clients/c1/resources",
        "DELETE /trainers/me/clients/c1/resources/a1",
        "POST /trainers/me/media/uploads",
      ]);
      const body = (i: number) =>
        JSON.parse(String(calls[i]!.init.body as string));
      expect(calls[1]!.init.headers).toMatchObject({ "Idempotency-Key": "k1" });
      expect(body(3)).toEqual({ resourceIds: ["r1"], clientIds: ["c1"] });
      expect(calls[3]!.init.headers).toMatchObject({ "Idempotency-Key": "k2" });
      expect(body(6)).toEqual({
        purpose: "resource",
        contentType: "image/png",
        bytes: 10,
      });
      expect(calls[6]!.init.headers).toMatchObject({ "Idempotency-Key": "k3" });
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      localStorage.clear();
    }
  });

  it("putUpload sends the presigned headers and maps failures", async () => {
    const upload = {
      url: "https://bucket.example/x",
      method: "PUT" as const,
      headers: { "content-type": "image/png" },
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const blob = new Blob(["x"]);
    const ok = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await coachApi.putUpload(upload, blob, ok);
    expect(ok).toHaveBeenCalledWith(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: blob,
    });
    const bad = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(coachApi.putUpload(upload, blob, bad)).rejects.toMatchObject({
      status: 403,
      code: "upload_failed",
    });
    const down = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(coachApi.putUpload(upload, blob, down)).rejects.toMatchObject({
      offline: true,
    });
  });
});
